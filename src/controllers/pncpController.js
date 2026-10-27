
const axios = require('axios');
const { randomUUID } = require('crypto');

const PNCP_URL_PUBLICACAO =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const PNCP_URL_PROPOSTA =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

const TAMANHO_PAGINA = 50;
const INTERVALO_REQUISICOES_MS = 800;
const TEMPO_CACHE_MS = 15 * 60 * 1000;
const TEMPO_RETENCAO_JOB_MS = 30 * 60 * 1000;
const MAX_TENTATIVAS = 4;
const MAX_PAGINAS_CONSULTA = 1000;

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

function converterDataParaISO(data) {
  if (!data) return '';

  const valor = String(data).trim();

  // Datas ISO ou timestamps: 2026-10-27 ou 2026-10-27T14:00:00
  const iso = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  // Datas no formato AAAAMMDD
  const compacta = valor.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (compacta) {
    return `${compacta[1]}-${compacta[2]}-${compacta[3]}`;
  }

  return '';
}

function adicionarDias(dataISO, quantidade) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);

  data.setDate(data.getDate() + quantidade);

  return dataLocalISO(data);
}

function listarDatasNoIntervalo(dataInicial, dataFinal) {
  const datas = [];
  let atual = dataInicial;

  while (atual <= dataFinal) {
    datas.push(atual);
    atual = adicionarDias(atual, 1);
  }

  return datas;
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
    return [
      ...new Set(
        entrada
          .map(String)
          .map((termo) => termo.trim())
          .filter(Boolean)
      ),
    ];
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
    ? Math.min(Math.floor(total), MAX_PAGINAS_CONSULTA)
    : 1;
}

function chavePagina(filtros, pagina, fonte, dataReferencia = '') {
  return [
    fonte,
    filtros.dataInicial,
    filtros.dataFinal,
    filtros.uf || '',
    filtros.modalidade ?? 'todas',
    dataReferencia,
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
      job.status !== 'queued' &&
      agora - job.updatedAt > TEMPO_RETENCAO_JOB_MS
    ) {
      jobs.delete(id);
    }
  }
}

function montarParametros(filtros, pagina, fonte, dataReferencia) {
  const params = {
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  };

  if (fonte === 'proposta') {
    // O endpoint de propostas abertas recebe dataFinal,
    // não dataInicial e dataFinal.
    params.dataFinal = formatarData(dataReferencia);
  } else {
    params.dataInicial = formatarData(filtros.dataInicial);
    params.dataFinal = formatarData(filtros.dataFinal);
  }

  if (filtros.uf) {
    params.uf = filtros.uf;
  }

  if (filtros.modalidade !== null) {
    params.codigoModalidadeContratacao = filtros.modalidade;
  }

  return params;
}

async function requisitarPaginaPncp(
  filtros,
  pagina,
  fonte = 'publicacao',
  dataReferencia = ''
) {
  limparCaches();

  const chave = chavePagina(
    filtros,
    pagina,
    fonte,
    dataReferencia
  );

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

    const url =
      fonte === 'proposta'
        ? PNCP_URL_PROPOSTA
        : PNCP_URL_PUBLICACAO;

    const params = montarParametros(
      filtros,
      pagina,
      fonte,
      dataReferencia
    );

    let ultimoErro;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      try {
        const resposta = await axios.get(url, {
          params,
          timeout: 25000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Gestorae/1.0',
          },
        });

        if (!Array.isArray(resposta.data?.data)) {
          throw new Error(
            `O PNCP retornou uma resposta inesperada na consulta de ${fonte}.`
          );
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

        const retryAfter = Number(
          erro.response?.headers?.['retry-after']
        );

        const espera =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2000 * (2 ** tentativa), 20000);

        await aguardar(espera);
      }
    }

    const status = ultimoErro?.response?.status;

    const erroFinal = new Error(
      status === 429
        ? 'O PNCP está limitando as consultas. Tente novamente mais tarde.'
        : `Falha ao consultar o PNCP (${fonte}): ${
            ultimoErro?.message || 'erro desconhecido'
          }`
    );

    erroFinal.status = status === 429 ? 429 : 502;

    throw erroFinal;
  });
}

function obterIdentificador(registro) {
  return (
    registro?.numeroControlePNCP ||
    registro?.id ||
    [
      registro?.orgaoEntidade?.cnpj,
      registro?.anoCompra,
      registro?.sequencialCompra,
    ]
      .filter(Boolean)
      .join('-') ||
    null
  );
}

function removerDuplicatas(registros) {
  const vistos = new Set();

  return registros.filter((registro) => {
    const id = obterIdentificador(registro);

    if (!id) return true;
    if (vistos.has(id)) return false;

    vistos.add(id);

    return true;
  });
}

function obterDataAbertura(registro) {
  const possiveisCampos = [
    registro?.dataAberturaProposta,
    registro?.dataInicioRecebimentoPropostas,
    registro?.dataInicioProposta,
  ];

  for (const campo of possiveisCampos) {
    const data = converterDataParaISO(campo);

    if (data) return data;
  }

  return '';
}

function aberturaDentroDoIntervalo(registro, filtros) {
  const abertura = obterDataAbertura(registro);

  // Para pesquisar por abertura, não incluímos registros
  // sem uma data de abertura identificável.
  if (!abertura) return false;

  return (
    abertura >= filtros.dataInicial &&
    abertura <= filtros.dataFinal
  );
}

function registroCorresponde(registro, termos) {
  if (!termos.length) return true;

  const texto = normalizarTexto([
    registro?.objetoCompra,
    registro?.informacaoComplementar,
    registro?.modalidadeNome,
    registro?.orgaoEntidade?.razaoSocial,
    registro?.unidadeOrgao?.nomeUnidade,
    registro?.unidadeOrgao?.municipioNome,
    registro?.unidadeOrgao?.ufSigla,
  ].filter(Boolean).join(' '));

  return termos.some((termo) =>
    texto.includes(normalizarTexto(termo))
  );
}

function obterFiltros(entrada) {
  const hoje = dataLocalISO();
  const dataFinalPadrao = adicionarDias(hoje, 30);

  const dataInicial = converterDataParaISO(
    entrada.dataInicial || hoje
  );

  const dataFinal = converterDataParaISO(
    entrada.dataFinal || dataFinalPadrao
  );

  if (!dataInicial || !dataFinal) {
    const erro = new Error(
      'Informe datas válidas no formato YYYY-MM-DD.'
    );

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

  const uf = String(entrada.uf || '')
    .trim()
    .toUpperCase();

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

function atualizarProgresso(job) {
  const percentual =
    job.totalPaginas > 0
      ? Math.floor(
          (job.paginasConcluidas / job.totalPaginas) * 100
        )
      : 0;

  return job.status === 'completed'
    ? 100
    : Math.min(99, percentual);
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
    progresso: atualizarProgresso(job),
    paginasConcluidas: job.paginasConcluidas,
    totalPaginasConsulta: job.totalPaginas,
    totalRegistros,
    totalPaginas,
    numeroPagina: paginaSegura,
    data: job.resultados.slice(
      inicio,
      inicio + TAMANHO_PAGINA
    ),
    erro: job.erro || null,
    empty:
      job.status === 'completed' &&
      totalRegistros === 0,
  };
}

async function processarJob(job) {
  try {
    job.status = 'running';
    job.updatedAt = Date.now();

    const idsProcessados = new Set();

    const processarRegistros = (registros) => {
      for (const registro of registros) {
        const id = obterIdentificador(registro);

        if (id && idsProcessados.has(id)) continue;
        if (id) idsProcessados.add(id);

        if (!aberturaDentroDoIntervalo(registro, job.filtros)) {
          continue;
        }

        if (!registroCorresponde(registro, job.termos)) {
          continue;
        }

        job.resultados.push(registro);
      }
    };

    // FONTE 1: contratações por data de publicação.
    // Serve como uma das fontes de descoberta; a data de abertura
    // é validada individualmente antes de incluir o resultado.
    const primeiraPublicacao = await requisitarPaginaPncp(
      job.filtros,
      1,
      'publicacao'
    );

    const totalPaginasPublicacao = totalPaginasDaResposta(
      primeiraPublicacao
    );

    job.totalPaginas += totalPaginasPublicacao;

    processarRegistros(primeiraPublicacao.data);

    job.paginasConcluidas += 1;
    job.updatedAt = Date.now();

    for (
      let pagina = 2;
      pagina <= totalPaginasPublicacao;
      pagina++
    ) {
      const resposta = await requisitarPaginaPncp(
        job.filtros,
        pagina,
        'publicacao'
      );

      processarRegistros(resposta.data);

      job.paginasConcluidas += 1;
      job.updatedAt = Date.now();
    }

    // FONTE 2: contratações com recebimento de propostas aberto.
    // Consultamos cada dia do intervalo para aumentar a cobertura
    // de oportunidades com períodos de proposta diferentes.
    const datas = listarDatasNoIntervalo(
      job.filtros.dataInicial,
      job.filtros.dataFinal
    );

    for (const dataReferencia of datas) {
      const primeiraProposta = await requisitarPaginaPncp(
        job.filtros,
        1,
        'proposta',
        dataReferencia
      );

      const totalPaginasProposta = totalPaginasDaResposta(
        primeiraProposta
      );

      job.totalPaginas += totalPaginasProposta;

      processarRegistros(primeiraProposta.data);

      job.paginasConcluidas += 1;
      job.updatedAt = Date.now();

      for (
        let pagina = 2;
        pagina <= totalPaginasProposta;
        pagina++
      ) {
        const resposta = await requisitarPaginaPncp(
          job.filtros,
          pagina,
          'proposta',
          dataReferencia
        );

        processarRegistros(resposta.data);

        job.paginasConcluidas += 1;
        job.updatedAt = Date.now();
      }
    }

    // Prioriza as datas de abertura mais próximas.
    job.resultados = removerDuplicatas(job.resultados).sort(
      (a, b) => {
        const dataA = obterDataAbertura(a);
        const dataB = obterDataAbertura(b);

        return dataA.localeCompare(dataB);
      }
    );

    job.status = 'completed';
    job.updatedAt = Date.now();
  } catch (erro) {
    job.status = 'failed';
    job.erro =
      erro.message || 'Erro ao processar a pesquisa.';
    job.updatedAt = Date.now();
  }
}

async function startPncpSearch(req, res) {
  try {
    const filtros = obterFiltros(req.body || {});
    const termos = extrairTermosDeBusca(req.body?.termo);

    if (termos.length === 0) {
      return res.status(400).json({
        message:
          'Informe ao menos um termo para iniciar a pesquisa em segundo plano.',
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

    setImmediate(() => {
      processarJob(job);
    });

    return res.status(202).json({
      jobId: id,
      status: job.status,
      message: 'Pesquisa combinada iniciada.',
    });
  } catch (erro) {
    return res.status(erro.status || 500).json({
      message:
        erro.message || 'Não foi possível iniciar a pesquisa.',
    });
  }
}

function getPncpSearchJob(req, res) {
  limparCaches();

  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      message:
        'Pesquisa não encontrada ou expirada. Inicie uma nova consulta.',
    });
  }

  return res.json(
    montarRespostaJob(job, req.query.pagina || 1)
  );
}

// Consulta tradicional mantida para compatibilidade com o frontend.
// A combinação das duas fontes é executada nas pesquisas em segundo plano.
async function searchPncpBids(req, res) {
  try {
    const filtros = obterFiltros(req.query);

    const pagina = Math.max(
      1,
      Math.floor(Number(req.query.pagina) || 1)
    );

    const resposta = await requisitarPaginaPncp(
      filtros,
      pagina,
      'publicacao'
    );

    const registros = removerDuplicatas(resposta.data).filter(
      (registro) =>
        aberturaDentroDoIntervalo(registro, filtros)
    );

    return res.json({
      data: registros,
      totalRegistros: Number(
        resposta.totalRegistros ?? registros.length
      ),
      totalPaginas: totalPaginasDaResposta(resposta),
      numeroPagina: pagina,
      paginasRestantes: Math.max(
        0,
        totalPaginasDaResposta(resposta) - pagina
      ),
      empty: registros.length === 0,
    });
  } catch (erro) {
    console.error('Erro na consulta PNCP:', erro.message);

    return res.status(erro.status || 502).json({
      message:
        erro.message || 'Não foi possível consultar o PNCP.',
      code:
        erro.status === 429
          ? 'PNCP_RATE_LIMIT'
          : 'PNCP_ERROR',
    });
  }
}

module.exports = {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
};
