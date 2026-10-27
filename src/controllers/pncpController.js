
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

  filaPncp = tarefa.then(
    () => undefined,
    () => undefined
  );

  return tarefa;
}

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

function adicionarDias(dataISO, quantidade) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);

  data.setDate(data.getDate() + quantidade);

  return dataLocalISO(data);
}

function converterDataParaISO(valor) {
  if (!valor) return '';

  const texto = String(valor).trim();

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const compacta = texto.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (compacta) {
    return `${compacta[1]}-${compacta[2]}-${compacta[3]}`;
  }

  return '';
}

function formatarDataPNCP(dataISO) {
  return String(dataISO || '').replace(/-/g, '');
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
          .map((item) => String(item).trim())
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

  return Number.isInteger(numero) && numero > 0
    ? numero
    : null;
}

function obterFiltros(entrada = {}) {
  const hoje = dataLocalISO();

  const dataInicial = converterDataParaISO(
    entrada.dataInicial || hoje
  );

  const dataFinal = converterDataParaISO(
    entrada.dataFinal || adicionarDias(hoje, 30)
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

  const modalidade = normalizarModalidade(
    entrada.modalidade
  );

  if (
    entrada.modalidade &&
    !['todas', 'todos', 'all', 'qualquer', '0'].includes(
      String(entrada.modalidade).trim().toLowerCase()
    ) &&
    modalidade === null
  ) {
    const erro = new Error('A modalidade informada é inválida.');

    erro.status = 400;
    throw erro;
  }

  return {
    dataInicial,
    dataFinal,
    uf,
    modalidade,
  };
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

function montarParametros(
  filtros,
  pagina,
  fonte,
  dataReferencia = ''
) {
  const params = {
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  };

  if (fonte === 'proposta') {
    // O PNCP usa dataFinal na consulta de propostas abertas.
    params.dataFinal = formatarDataPNCP(
      dataReferencia || filtros.dataFinal
    );
  } else {
    params.dataInicial = formatarDataPNCP(
      filtros.dataInicial
    );

    params.dataFinal = formatarDataPNCP(
      filtros.dataFinal
    );

    // A modalidade é obrigatória na consulta por publicação.
    if (filtros.modalidade === null) {
      const erro = new Error(
        'A consulta por publicação exige uma modalidade. ' +
        'Selecione uma modalidade ou consulte propostas abertas.'
      );

      erro.status = 400;
      throw erro;
    }

    params.codigoModalidadeContratacao = filtros.modalidade;
  }

  if (filtros.uf) {
    params.uf = filtros.uf;
  }

  return params;
}

function extrairRegistros(resposta, fonte) {
  const corpo = resposta?.data;

  // Formato esperado pela API de consulta do PNCP.
  if (Array.isArray(corpo?.data)) {
    return corpo;
  }

  // Resposta com array na raiz, caso o formato mude.
  if (Array.isArray(corpo)) {
    return {
      data: corpo,
      totalRegistros: corpo.length,
      totalPaginas: 1,
      numeroPagina: 1,
      paginasRestantes: 0,
      empty: corpo.length === 0,
    };
  }

  // Mensagem explícita ajuda a descobrir o que o PNCP devolveu.
  const detalhe =
    corpo?.message ||
    corpo?.mensagem ||
    corpo?.detail ||
    corpo?.title ||
    corpo?.error ||
    'O corpo da resposta não contém um array de registros.';

  console.error(
    `[PNCP] Estrutura inesperada (${fonte}).`,
    JSON.stringify({
      statusHTTP: resposta?.status,
      tipoResposta: typeof corpo,
      chaves: corpo && typeof corpo === 'object'
        ? Object.keys(corpo)
        : [],
      detalhe,
    })
  );

  const erro = new Error(
    `Resposta inesperada do PNCP (${fonte}): ${detalhe}`
  );

  erro.status = 502;
  throw erro;
}

function totalPaginasDaResposta(resposta) {
  const total = Number(resposta?.totalPaginas ?? 1);

  return Number.isFinite(total) && total >= 1
    ? Math.min(Math.floor(total), MAX_PAGINAS_CONSULTA)
    : 1;
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

    for (
      let tentativa = 0;
      tentativa < MAX_TENTATIVAS;
      tentativa++
    ) {
      try {
        const resposta = await axios.get(url, {
          params,
          timeout: 30000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Gestorae/1.0',
          },
        });

        const dados = extrairRegistros(resposta, fonte);

        cachePaginas.set(chave, {
          timestamp: Date.now(),
          dados,
        });

        await aguardar(INTERVALO_REQUISICOES_MS);

        return dados;
      } catch (erro) {
        ultimoErro = erro;

        const status = erro.response?.status;

        // Erros de estrutura são definitivos; não repetir a mesma resposta.
        if (
          String(erro.message || '').includes(
            'Resposta inesperada do PNCP'
          )
        ) {
          break;
        }

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

        console.warn(
          `[PNCP] Tentativa ${tentativa + 1} falhou (${fonte}). ` +
          `Nova tentativa em ${espera} ms.`
        );

        await aguardar(espera);
      }
    }

    const status = ultimoErro?.response?.status;
    const corpoErro = ultimoErro?.response?.data;

    console.error(`[PNCP] Falha na consulta (${fonte}).`, {
      url,
      params,
      statusHTTP: status || null,
      mensagem: ultimoErro?.message,
      respostaPNCP: corpoErro
        ? JSON.stringify(corpoErro).slice(0, 1500)
        : null,
    });

    if (ultimoErro?.status) {
      throw ultimoErro;
    }

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
    registro?.dataEncerramentoProposta,
    registro?.dataFimRecebimentoPropostas,
    registro?.dataFinalProposta,
  ];

  for (const campo of possiveisCampos) {
    const data = converterDataParaISO(campo);

    if (data) return data;
  }

  return '';
}

function aberturaDentroDoIntervalo(registro, filtros) {
  const abertura = obterDataAbertura(registro);

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
    registro?.modalidade,
    registro?.orgaoEntidade?.razaoSocial,
    registro?.unidadeOrgao?.nomeUnidade,
    registro?.unidadeOrgao?.municipioNome,
    registro?.unidadeOrgao?.ufSigla,
  ].filter(Boolean).join(' '));

  return termos.some((termo) =>
    texto.includes(normalizarTexto(termo))
  );
}

function atualizarProgresso(job) {
  if (job.status === 'completed') return 100;

  if (job.totalPaginas <= 0) return 0;

  return Math.min(
    99,
    Math.floor(
      (job.paginasConcluidas / job.totalPaginas) * 100
    )
  );
}

function montarRespostaJob(job, pagina = 1) {
  const totalRegistros = job.resultados.length;

  const totalPaginas = Math.max(
    1,
    Math.ceil(totalRegistros / TAMANHO_PAGINA)
  );

  const paginaSolicitada = Math.floor(Number(pagina) || 1);

  const paginaSegura = Math.max(
    1,
    Math.min(paginaSolicitada, totalPaginas)
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

    function processarRegistros(registros) {
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
    }

    // Fonte de propostas abertas.
    // dataFinal representa o limite de consulta da API.
    const primeiraProposta = await requisitarPaginaPncp(
      job.filtros,
      1,
      'proposta',
      job.filtros.dataFinal
    );

    const totalPaginasProposta =
      totalPaginasDaResposta(primeiraProposta);

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
        job.filtros.dataFinal
      );

      processarRegistros(resposta.data);

      job.paginasConcluidas += 1;
      job.updatedAt = Date.now();
    }

    // Fonte de publicação: a API exige uma modalidade.
    // Só executamos essa consulta quando o usuário escolheu uma.
    if (job.filtros.modalidade !== null) {
      const primeiraPublicacao = await requisitarPaginaPncp(
        job.filtros,
        1,
        'publicacao'
      );

      const totalPaginasPublicacao =
        totalPaginasDaResposta(primeiraPublicacao);

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
    }

    job.resultados = removerDuplicatas(job.resultados).sort(
      (a, b) =>
        obterDataAbertura(a).localeCompare(obterDataAbertura(b))
    );

    job.status = 'completed';
    job.updatedAt = Date.now();
  } catch (erro) {
    console.error('[PNCP] Erro ao processar pesquisa em segundo plano:', {
      jobId: job.id,
      mensagem: erro.message,
      status: erro.status || erro.response?.status || null,
      respostaPNCP: erro.response?.data
        ? JSON.stringify(erro.response.data).slice(0, 1500)
        : null,
    });

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
      message: 'Pesquisa no PNCP iniciada.',
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

async function searchPncpBids(req, res) {
  try {
    const filtros = obterFiltros(req.query);

    const pagina = Math.max(
      1,
      Math.floor(Number(req.query.pagina) || 1)
    );

    // Sem modalidade, a API de publicação não pode ser chamada.
    // Nesse caso, usa-se a consulta de propostas abertas.
    const fonte =
      filtros.modalidade === null
        ? 'proposta'
        : 'publicacao';

    const resposta = await requisitarPaginaPncp(
      filtros,
      pagina,
      fonte,
      filtros.dataFinal
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
      fonteConsultada: fonte,
    });
  } catch (erro) {
    console.error('[PNCP] Erro na consulta direta:', {
      mensagem: erro.message,
      status: erro.status || erro.response?.status || null,
      respostaPNCP: erro.response?.data
        ? JSON.stringify(erro.response.data).slice(0, 1500)
        : null,
    });

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
