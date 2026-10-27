

const axios = require('axios');
const { randomUUID } = require('crypto');

const PNCP_URL =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const TAMANHO_PAGINA = 50;
const INTERVALO_REQUISICOES_MS = 800;
const TEMPO_CACHE_MS = 15 * 60 * 1000;
const TEMPO_RETENCAO_JOB_MS = 30 * 60 * 1000;
const MAX_TENTATIVAS = 4;

const cachePaginas = new Map();
const jobs = new Map();
let filaPncp = Promise.resolve();

const aguardar = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function executarNaFila(funcao) {
  const tarefa = filaPncp.then(funcao, funcao);
  filaPncp = tarefa.then(() => undefined, () => undefined);
  return tarefa;
}

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

function formatarData(data) {
  if (!data) return '';

  const valor = String(data).trim();

  if (/^\d{8}$/.test(valor)) return valor;

  const match = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairTermosDeBusca(entrada) {
  if (Array.isArray(entrada)) {
    return [...new Set(entrada.map(String).map(t => t.trim()).filter(Boolean))];
  }

  const texto = String(entrada ?? '').trim();
  if (!texto) return [];

  const termos = [];
  const regex = /"([^"]+)"|([^,]+)/g;
  let match;

  while ((match = regex.exec(texto)) !== null) {
    const termo = (match[1] ?? match[2] ?? '').trim();
    if (termo) termos.push(termo);
  }

  return [...new Set(termos)];
}

function normalizarModalidade(valor) {
  if (valor === undefined || valor === null) return null;

  const texto = String(valor).trim().toLowerCase();

  if (
    !texto ||
    ['todas', 'todos', 'all', 'qualquer', '0'].includes(texto)
  ) {
    return null;
  }

  const numero = Number(texto);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function totalPaginasDaResposta(resposta) {
  const total = Number(resposta?.totalPaginas ?? 1);
  return Number.isFinite(total) && total >= 1
    ? Math.floor(total)
    : 1;
}

function chavePagina(filtros, pagina) {
  return [
    filtros.dataInicial,
    filtros.dataFinal,
    filtros.uf || '',
    filtros.modalidade ?? 'todas',
    pagina,
  ].join('|');
}

function limparCaches() {
  const agora = Date.now();

  for (const [chave, item] of cachePaginas.entries()) {
    if (agora - item.timestamp > TEMPO_CACHE_MS) {
      cachePaginas.delete(chave);
    }
  }

  for (const [id, job] of jobs.entries()) {
    if (
      job.status !== 'running' &&
      agora - job.updatedAt > TEMPO_RETENCAO_JOB_MS
    ) {
      jobs.delete(id);
    }
  }
}

async function requisitarPaginaPncp(filtros, pagina) {
  limparCaches();

  const chave = chavePagina(filtros, pagina);
  const cache = cachePaginas.get(chave);

  if (cache && Date.now() - cache.timestamp < TEMPO_CACHE_MS) {
    return cache.dados;
  }

  return executarNaFila(async () => {
    const cacheAtual = cachePaginas.get(chave);

    if (
      cacheAtual &&
      Date.now() - cacheAtual.timestamp < TEMPO_CACHE_MS
    ) {
      return cacheAtual.dados;
    }

    const params = {
      dataInicial: filtros.dataInicial,
      dataFinal: filtros.dataFinal,
      pagina,
      tamanhoPagina: TAMANHO_PAGINA,
    };

    if (filtros.uf) params.uf = filtros.uf;

    if (filtros.modalidade !== null) {
      params.codigoModalidadeContratacao = filtros.modalidade;
    }

    let ultimoErro;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      try {
        const resposta = await axios.get(PNCP_URL, {
          params,
          timeout: 25000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Gestorae/1.0',
          },
        });

        if (!Array.isArray(resposta.data?.data)) {
          throw new Error('O PNCP retornou uma resposta inesperada.');
        }

        cachePaginas.set(chave, {
          timestamp: Date.now(),
          dados: resposta.data,
        });

        await aguardar(INTERVALO_REQUISICOES_MS);

        return resposta.data;
      } catch (erro) {
        ultimoErro = erro;

        const status = erro.response?.status;
        const podeRepetir =
          status === 429 ||
          status === 408 ||
          status >= 500 ||
          !erro.response;

        if (!podeRepetir || tentativa === MAX_TENTATIVAS - 1) {
          break;
        }

        const retryAfter = Number(erro.response?.headers?.['retry-after']);

        const espera =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2000 * (2 ** tentativa), 20000);

        await aguardar(espera);
      }
    }

    const erroFinal = new Error(
      ultimoErro?.response?.status === 429
        ? 'O PNCP está limitando as consultas. Tente novamente mais tarde.'
        : `Falha ao consultar o PNCP: ${ultimoErro?.message || 'erro desconhecido'}`
    );

    erroFinal.status =
      ultimoErro?.response?.status === 429 ? 429 : 502;

    throw erroFinal;
  });
}

function removerDuplicatas(registros) {
  const vistos = new Set();

  return registros.filter((registro) => {
    const id =
      registro.numeroControlePNCP ||
      registro.id ||
      [
        registro.orgaoEntidade?.cnpj,
        registro.anoCompra,
        registro.sequencialCompra,
      ].filter(Boolean).join('-');

    if (!id) return true;
    if (vistos.has(id)) return false;

    vistos.add(id);
    return true;
  });
}

function registroCorresponde(registro, termos) {
  const texto = normalizarTexto([
    registro.objetoCompra,
    registro.informacaoComplementar,
    registro.modalidadeNome,
    registro.orgaoEntidade?.razaoSocial,
    registro.unidadeOrgao?.nomeUnidade,
    registro.unidadeOrgao?.municipioNome,
    registro.unidadeOrgao?.ufSigla,
  ].filter(Boolean).join(' '));

  return termos.some((termo) =>
    texto.includes(normalizarTexto(termo))
  );
}

function obterFiltros(entrada) {
  const hoje = dataLocalISO();
  const dataFinalPadrao = new Date();
  dataFinalPadrao.setDate(dataFinalPadrao.getDate() + 30);

  const dataInicial = formatarData(entrada.dataInicial || hoje);
  const dataFinal = formatarData(
    entrada.dataFinal || dataLocalISO(dataFinalPadrao)
  );

  if (!dataInicial || !dataFinal) {
    const erro = new Error('Informe datas válidas no formato YYYY-MM-DD.');
    erro.status = 400;
    throw erro;
  }

  if (dataInicial > dataFinal) {
    const erro = new Error(
      'A data inicial não pode ser posterior à data final.'
    );
    erro.status = 400;
    throw erro;
  }

  const uf = String(entrada.uf || '').trim().toUpperCase();

  if (uf && !/^[A-Z]{2}$/.test(uf)) {
    const erro = new Error('A UF informada é inválida.');
    erro.status = 400;
    throw erro;
  }

  return {
    dataInicial,
    dataFinal,
    uf,
    modalidade: normalizarModalidade(entrada.modalidade),
  };
}

function montarRespostaJob(job, pagina = 1) {
  const totalRegistros = job.resultados.length;
  const totalPaginas = Math.max(
    1,
    Math.ceil(totalRegistros / TAMANHO_PAGINA)
  );

  const paginaSegura = Math.max(
    1,
    Math.min(Number(pagina) || 1, totalPaginas)
  );

  const inicio = (paginaSegura - 1) * TAMANHO_PAGINA;

  return {
    jobId: job.id,
    status: job.status,
    progresso: job.totalPaginas > 0
      ? Math.floor((job.paginasConcluidas / job.totalPaginas) * 100)
      : 0,
    paginasConcluidas: job.paginasConcluidas,
    totalPaginasConsulta: job.totalPaginas,
    totalRegistros: job.status === 'completed'
      ? totalRegistros
      : totalRegistros,
    totalPaginas,
    numeroPagina: paginaSegura,
    data: job.resultados.slice(inicio, inicio + TAMANHO_PAGINA),
    erro: job.erro || null,
    empty: job.status === 'completed' && totalRegistros === 0,
  };
}

async function processarJob(job) {
  try {
    job.status = 'running';
    job.updatedAt = Date.now();

    const primeira = await requisitarPaginaPncp(job.filtros, 1);
    job.totalPaginas = Math.min(totalPaginasDaResposta(primeira), 1000);

    const vistos = new Set();

    const processarRegistros = (registros) => {
      for (const registro of registros) {
        const id =
          registro.numeroControlePNCP ||
          registro.id ||
          [
            registro.orgaoEntidade?.cnpj,
            registro.anoCompra,
            registro.sequencialCompra,
          ].filter(Boolean).join('-');

        if (id && vistos.has(id)) continue;
        if (id) vistos.add(id);

        if (registroCorresponde(registro, job.termos)) {
          job.resultados.push(registro);
        }
      }
    };

    processarRegistros(primeira.data);
    job.paginasConcluidas = 1;
    job.updatedAt = Date.now();

    for (let pagina = 2; pagina <= job.totalPaginas; pagina++) {
      const resposta = await requisitarPaginaPncp(job.filtros, pagina);

      processarRegistros(resposta.data);

      job.paginasConcluidas = pagina;
      job.updatedAt = Date.now();
    }

    job.status = 'completed';
    job.updatedAt = Date.now();
  } catch (erro) {
    job.status = 'failed';
    job.erro = erro.message || 'Erro ao processar a pesquisa.';
    job.updatedAt = Date.now();
  }
}

async function startPncpSearch(req, res) {
  try {
    const filtros = obterFiltros(req.body || {});
    const termos = extrairTermosDeBusca(req.body?.termo);

    if (termos.length === 0) {
      return res.status(400).json({
        message: 'Informe ao menos um termo para iniciar a pesquisa em segundo plano.',
      });
    }

    const id = randomUUID();

    const job = {
      id,
      status: 'queued',
      filtros,
      termos,
      resultados: [],
      paginasConcluidas: 0,
      totalPaginas: 0,
      erro: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    jobs.set(id, job);

    // Não aguardamos o processamento terminar para responder ao frontend.
    setImmediate(() => {
      processarJob(job);
    });

    return res.status(202).json({
      jobId: id,
      status: job.status,
      message: 'Pesquisa iniciada.',
    });
  } catch (erro) {
    return res.status(erro.status || 500).json({
      message: erro.message || 'Não foi possível iniciar a pesquisa.',
    });
  }
}

function getPncpSearchJob(req, res) {
  limparCaches();

  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      message: 'Pesquisa não encontrada ou expirada. Inicie uma nova consulta.',
    });
  }

  return res.json(
    montarRespostaJob(job, req.query.pagina || 1)
  );
}

async function searchPncpBids(req, res) {
  try {
    const filtros = obterFiltros(req.query);
    const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1));
    const resposta = await requisitarPaginaPncp(filtros, pagina);

    return res.json({
      data: resposta.data,
      totalRegistros: Number(resposta.totalRegistros ?? 0),
      totalPaginas: totalPaginasDaResposta(resposta),
      numeroPagina: pagina,
      paginasRestantes: Math.max(
        0,
        totalPaginasDaResposta(resposta) - pagina
      ),
      empty: resposta.data.length === 0,
    });
  } catch (erro) {
    console.error('Erro na consulta PNCP:', erro.message);

    return res.status(erro.status || 502).json({
      message: erro.message || 'Não foi possível consultar o PNCP.',
      code: erro.status === 429 ? 'PNCP_RATE_LIMIT' : 'PNCP_ERROR',
    });
  }
}

module.exports = {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
};
