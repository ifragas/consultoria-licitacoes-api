
const axios = require('axios');
const crypto = require('crypto');

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const PNCP_BASE_URL = 'https://pncp.gov.br/api/consulta/v1';

const URL_PUBLICACAO = `${PNCP_BASE_URL}/contratacoes/publicacao`;
const URL_PROPOSTA = `${PNCP_BASE_URL}/contratacoes/proposta`;
const URL_MODALIDADES = `${PNCP_BASE_URL}/modalidades`;

const TAMANHO_PAGINA = 50;
const INTERVALO_REQUISICOES_MS = 1500;
const ESPERA_RATE_LIMIT_MS = 60_000;
const MAX_TENTATIVAS = 3;
const MAX_PAGINAS_CONSULTA = 1000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const JOB_RETENTION_MS = 30 * 60 * 1000;
const TIMEOUT_REQUISICAO_MS = 30_000;

// Ative/desative os diagnósticos pelo Render.
const DEBUG_PNCP = process.env.DEBUG_PNCP !== 'false';

// ============================================================
// ESTADO EM MEMÓRIA
// ============================================================

const cachePaginas = new Map();
const jobs = new Map();
const filaJobs = [];

let processamentoFilaAtivo = false;
let ultimaRequisicaoPncp = 0;
let bloqueioPncpAte = 0;
let filaPncp = Promise.resolve();

// ============================================================
// UTILITÁRIOS
// ============================================================

function logDebug(...args) {
  if (DEBUG_PNCP) {
    console.info('[PNCP][DEBUG]', ...args);
  }
}

function dormir(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarData(data) {
  if (!data) return null;

  const valor = String(data).trim();

  if (/^\d{8}$/.test(valor)) {
    return valor;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor.replace(/-/g, '');
  }

  return null;
}

function validarData(data) {
  if (!/^\d{8}$/.test(String(data || ''))) {
    return false;
  }

  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(4, 6));
  const dia = Number(data.slice(6, 8));

  if (ano < 2000 || mes < 1 || mes > 12 || dia < 1) {
    return false;
  }

  const dataObj = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    dataObj.getUTCFullYear() === ano &&
    dataObj.getUTCMonth() === mes - 1 &&
    dataObj.getUTCDate() === dia
  );
}

function dataHojeFormatoPncp() {
  const agora = new Date();

  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');

  return `${ano}${mes}${dia}`;
}

function dataDiasAntesFormatoPncp(dataBase, dias) {
  const ano = Number(dataBase.slice(0, 4));
  const mes = Number(dataBase.slice(4, 6));
  const dia = Number(dataBase.slice(6, 8));

  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - dias);

  const anoResultado = data.getUTCFullYear();
  const mesResultado = String(data.getUTCMonth() + 1).padStart(2, '0');
  const diaResultado = String(data.getUTCDate()).padStart(2, '0');

  return `${anoResultado}${mesResultado}${diaResultado}`;
}

function obterFiltros(entrada = {}) {
  const dataInicialInformada = normalizarData(entrada.dataInicial);
  const dataFinalInformada = normalizarData(entrada.dataFinal);

  if (entrada.dataInicial && !dataInicialInformada) {
    throw new Error(
      'Data inicial inválida. Utilize AAAA-MM-DD ou AAAAMMDD.'
    );
  }

  if (entrada.dataFinal && !dataFinalInformada) {
    throw new Error(
      'Data final inválida. Utilize AAAA-MM-DD ou AAAAMMDD.'
    );
  }

  if (
    dataInicialInformada &&
    !validarData(dataInicialInformada)
  ) {
    throw new Error('A data inicial não é uma data válida.');
  }

  if (
    dataFinalInformada &&
    !validarData(dataFinalInformada)
  ) {
    throw new Error('A data final não é uma data válida.');
  }

  const dataFinal =
    dataFinalInformada || dataHojeFormatoPncp();

  const dataInicial =
    dataInicialInformada ||
    dataDiasAntesFormatoPncp(dataFinal, 30);

  if (dataInicial > dataFinal) {
    throw new Error(
      'A data inicial não pode ser posterior à data final.'
    );
  }

  const uf = String(entrada.uf || '')
    .trim()
    .toUpperCase();

  if (uf && !/^[A-Z]{2}$/.test(uf)) {
    throw new Error(
      'UF inválida. Informe uma sigla de dois caracteres.'
    );
  }

  const modalidades = obterModalidades(entrada);

  return {
    dataInicial,
    dataFinal,
    uf,
    modalidades,
    termo: String(entrada.termo || '').trim(),
  };
}

function obterModalidades(entrada = {}) {
  let valores = entrada.modalidades;

  if (valores === undefined || valores === null) {
    valores =
      entrada.modalidade !== undefined &&
      entrada.modalidade !== null &&
      entrada.modalidade !== ''
        ? [entrada.modalidade]
        : [];
  }

  if (typeof valores === 'string') {
    valores = valores
      .split(',')
      .map((valor) => valor.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(valores)) {
    valores = [valores];
  }

  return [
    ...new Set(
      valores
        .map((valor) => Number(valor))
        .filter((valor) => Number.isInteger(valor) && valor > 0)
    ),
  ];
}

function extrairRegistros(resposta) {
  if (Array.isArray(resposta)) return resposta;
  if (Array.isArray(resposta?.data)) return resposta.data;
  if (Array.isArray(resposta?.items)) return resposta.items;
  if (Array.isArray(resposta?.content)) return resposta.content;

  return [];
}

function extrairTotalPaginas(resposta) {
  const possiveisValores = [
    resposta?.totalPaginas,
    resposta?.totalPages,
    resposta?.total_pages,
    resposta?.pagination?.totalPages,
    resposta?.paginacao?.totalPaginas,
  ];

  for (const valor of possiveisValores) {
    const numero = Number(valor);

    if (Number.isInteger(numero) && numero >= 0) {
      return numero;
    }
  }

  return null;
}

function extrairIdentificador(item) {
  const cnpj = item?.orgaoEntidade?.cnpj;
  const ano = item?.anoCompra;
  const sequencial = item?.sequencialCompra;

  if (cnpj && ano && sequencial) {
    return `${cnpj}-${ano}-${sequencial}`;
  }

  const controlePNCP =
    item?.numeroControlePNCP ||
    item?.numeroControlePncp ||
    item?.id;

  if (controlePNCP) {
    return String(controlePNCP);
  }

  return [
    item?.objetoCompra || item?.objeto || '',
    item?.dataPublicacaoPncp || item?.dataPublicacao || '',
    item?.orgaoEntidade?.razaoSocial || '',
    item?.numeroCompra || '',
  ].join('|');
}

function obterTextoPesquisa(item) {
  return [
    item?.objetoCompra,
    item?.objeto,
    item?.informacaoComplementar,
    item?.orgaoEntidade?.razaoSocial,
    item?.unidadeOrgao?.nomeUnidade,
    item?.unidadeOrgao?.municipioNome,
    item?.modalidadeNome,
  ]
    .filter(Boolean)
    .join(' ');
}

function correspondeAoTermo(item, termo) {
  if (!termo) return true;

  return normalizarTexto(obterTextoPesquisa(item))
    .includes(normalizarTexto(termo));
}

function obterRetryAfterMs(headers = {}) {
  const valor =
    headers['retry-after'] ??
    headers['Retry-After'];

  if (valor === undefined || valor === null) {
    return ESPERA_RATE_LIMIT_MS;
  }

  const segundos = Number(valor);

  if (Number.isFinite(segundos) && segundos >= 0) {
    return Math.max(ESPERA_RATE_LIMIT_MS, segundos * 1000);
  }

  const dataRetry = Date.parse(String(valor));

  if (Number.isFinite(dataRetry)) {
    return Math.max(
      ESPERA_RATE_LIMIT_MS,
      dataRetry - Date.now()
    );
  }

  return ESPERA_RATE_LIMIT_MS;
}

function criarErroHttp(mensagem, status, detalhes = {}) {
  const erro = new Error(mensagem);
  erro.status = status;
  Object.assign(erro, detalhes);
  return erro;
}

// ============================================================
// CACHE E FILA GLOBAL DE REQUISIÇÕES PNCP
// ============================================================

function obterCache(chave) {
  const registro = cachePaginas.get(chave);

  if (!registro) return null;

  if (Date.now() - registro.criadoEm > CACHE_TTL_MS) {
    cachePaginas.delete(chave);
    return null;
  }

  return registro.valor;
}

function salvarCache(chave, valor) {
  cachePaginas.set(chave, {
    criadoEm: Date.now(),
    valor,
  });
}

async function respeitarLimitePncp() {
  const tempoBloqueado = bloqueioPncpAte - Date.now();

  if (tempoBloqueado > 0) {
    await dormir(tempoBloqueado);
  }

  const tempoDesdeUltimaRequisicao =
    Date.now() - ultimaRequisicaoPncp;

  const tempoRestante =
    INTERVALO_REQUISICOES_MS - tempoDesdeUltimaRequisicao;

  if (tempoRestante > 0) {
    await dormir(tempoRestante);
  }

  const bloqueioRestante = bloqueioPncpAte - Date.now();

  if (bloqueioRestante > 0) {
    await dormir(bloqueioRestante);
  }

  ultimaRequisicaoPncp = Date.now();
}

function executarNaFilaPncp(funcao) {
  const execucao = filaPncp.then(funcao, funcao);
  filaPncp = execucao.catch(() => {});
  return execucao;
}

async function requisitarPncp(url, parametros = {}, opcoes = {}) {
  const chaveCache = JSON.stringify({
    url,
    parametros,
    metodo: 'GET',
  });

  if (!opcoes.ignorarCache) {
    const cacheado = obterCache(chaveCache);

    if (cacheado !== null) {
      logDebug('CACHE HIT', {
        endpoint: url,
        parametros,
      });

      return cacheado;
    }
  }

  return executarNaFilaPncp(async () => {
    if (!opcoes.ignorarCache) {
      const cacheado = obterCache(chaveCache);

      if (cacheado !== null) {
        logDebug('CACHE HIT após espera na fila', {
          endpoint: url,
          parametros,
        });

        return cacheado;
      }
    }

    let ultimaFalha;

    for (
      let tentativa = 1;
      tentativa <= MAX_TENTATIVAS;
      tentativa += 1
    ) {
      await respeitarLimitePncp();

      logDebug('REQUISIÇÃO', {
        endpoint: url,
        parametros,
        tentativa,
      });

      try {
        const resposta = await axios.get(url, {
          params: parametros,
          timeout: TIMEOUT_REQUISICAO_MS,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Gestorae/1.0',
          },
          validateStatus: () => true,
        });

        if (resposta.status === 429) {
          const esperaMs = obterRetryAfterMs(
            resposta.headers || {}
          );

          bloqueioPncpAte = Math.max(
            bloqueioPncpAte,
            Date.now() + esperaMs
          );

          console.warn('[PNCP][429] Limite de requisições atingido.', {
            endpoint: url,
            parametros,
            tentativa,
            esperaSegundos: Math.ceil(esperaMs / 1000),
          });

          throw criarErroHttp(
            `O PNCP limitou as requisições. Nova tentativa em aproximadamente ${Math.ceil(
              esperaMs / 1000
            )} segundos.`,
            429,
            { retryAfterMs: esperaMs }
          );
        }

        if (resposta.status < 200 || resposta.status >= 300) {
          logDebug('RESPOSTA HTTP COM ERRO', {
            endpoint: url,
            status: resposta.status,
            parametros,
          });

          throw criarErroHttp(
            `O PNCP respondeu com HTTP ${resposta.status}.`,
            resposta.status
          );
        }

        logDebug('RESPOSTA HTTP OK', {
          endpoint: url,
          status: resposta.status,
          parametros,
          formatoData: Array.isArray(resposta.data?.data)
            ? 'data é array'
            : typeof resposta.data?.data,
          totalRegistrosInformado: resposta.data?.totalRegistros,
          totalPaginasInformado: resposta.data?.totalPaginas,
          quantidadeData: Array.isArray(resposta.data?.data)
            ? resposta.data.data.length
            : null,
        });

        salvarCache(chaveCache, resposta.data);

        return resposta.data;
      } catch (erro) {
        ultimaFalha = erro;

        if (erro.status === 429 || erro.response?.status === 429) {
          throw erro;
        }

        const status = erro.status || erro.response?.status;

        if (
          status >= 400 &&
          status < 500 &&
          status !== 408
        ) {
          throw erro;
        }

        if (tentativa < MAX_TENTATIVAS) {
          await dormir(Math.min(2000 * tentativa, 10_000));
        }
      }
    }

    throw ultimaFalha || new Error('Falha ao consultar o PNCP.');
  });
}

// ============================================================
// MODALIDADES ATIVAS
// ============================================================

let cacheModalidades = null;
let cacheModalidadesCriadoEm = 0;

async function obterTodasModalidadesAtivas() {
  const validadeCache = 6 * 60 * 60 * 1000;

  if (
    cacheModalidades &&
    Date.now() - cacheModalidadesCriadoEm < validadeCache
  ) {
    logDebug('Utilizando cache de modalidades', cacheModalidades);
    return cacheModalidades;
  }

  const resposta = await requisitarPncp(
    URL_MODALIDADES,
    { statusAtivo: true }
  );

  let registros = extrairRegistros(resposta);

  if (
    registros.length === 0 &&
    Array.isArray(resposta?.data?.content)
  ) {
    registros = resposta.data.content;
  }

  logDebug('Resposta de modalidades', {
    quantidadeRegistros: registros.length,
    primeiroRegistro: registros[0] || null,
    formatoResposta: Object.keys(resposta || {}),
  });

  const modalidades = [
    ...new Set(
      registros
        .filter((item) => item?.statusAtivo !== false)
        .map((item) => Number(item?.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (modalidades.length === 0) {
    throw new Error(
      'Não foi possível obter as modalidades ativas do PNCP. ' +
      'Tente novamente ou selecione modalidades específicas.'
    );
  }

  cacheModalidades = modalidades;
  cacheModalidadesCriadoEm = Date.now();

  logDebug('Modalidades ativas carregadas', modalidades);

  return modalidades;
}

// ============================================================
// CONSTRUÇÃO DAS ETAPAS DE PESQUISA
// ============================================================

async function criarEtapas(filtros) {
  const etapas = [];

  etapas.push({
    fonte: 'proposta',
    modalidade: null,
    pagina: 1,
    totalPaginas: null,
    concluida: false,
  });

  const modalidades =
    filtros.modalidades.length > 0
      ? filtros.modalidades
      : await obterTodasModalidadesAtivas();

  for (const modalidade of modalidades) {
    etapas.push({
      fonte: 'publicacao',
      modalidade,
      pagina: 1,
      totalPaginas: null,
      concluida: false,
    });
  }

  logDebug('Etapas criadas', {
    dataInicial: filtros.dataInicial,
    dataFinal: filtros.dataFinal,
    uf: filtros.uf || '(todas)',
    termo: filtros.termo || '(nenhum)',
    modalidadesSelecionadas: filtros.modalidades,
    quantidadeEtapas: etapas.length,
    fontes: etapas.reduce((acc, etapa) => {
      acc[etapa.fonte] = (acc[etapa.fonte] || 0) + 1;
      return acc;
    }, {}),
  });

  return etapas;
}

function montarParametros(etapa, filtros) {
  const parametros = {
    pagina: etapa.pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  };

  if (etapa.fonte === 'proposta') {
    parametros.dataFinal = filtros.dataFinal;

    if (etapa.modalidade) {
      parametros.codigoModalidadeContratacao =
        etapa.modalidade;
    }

    if (filtros.uf) {
      parametros.uf = filtros.uf;
    }

    return parametros;
  }

  parametros.dataInicial = filtros.dataInicial;
  parametros.dataFinal = filtros.dataFinal;
  parametros.codigoModalidadeContratacao = etapa.modalidade;

  if (filtros.uf) {
    parametros.uf = filtros.uf;
  }

  return parametros;
}

async function consultarEtapa(etapa, filtros) {
  const url =
    etapa.fonte === 'proposta'
      ? URL_PROPOSTA
      : URL_PUBLICACAO;

  const parametros = montarParametros(etapa, filtros);

  return requisitarPncp(url, parametros);
}

// ============================================================
// RESULTADOS E PROGRESSO
// ============================================================

function adicionarResultados(job, registros) {
  let correspondentesAoTermo = 0;
  let novosResultados = 0;
  let duplicados = 0;

  for (const item of registros) {
    if (!item || typeof item !== 'object') continue;

    if (!correspondeAoTermo(item, job.filtros.termo)) {
      continue;
    }

    correspondentesAoTermo += 1;

    const identificador = extrairIdentificador(item);

    if (!job.idsResultados.has(identificador)) {
      job.idsResultados.add(identificador);
      job.resultados.push(item);
      novosResultados += 1;
    } else {
      duplicados += 1;
    }
  }

  return {
    registrosRecebidos: registros.length,
    correspondentesAoTermo,
    novosResultados,
    duplicados,
    totalAcumulado: job.resultados.length,
  };
}

function calcularProgresso(job) {
  if (job.etapas.length === 0) return 0;

  let totalPaginasEstimadas = 0;
  let paginasConcluidas = 0;

  for (const etapa of job.etapas) {
    const estimadas =
      etapa.totalPaginas ||
      (etapa.concluida ? etapa.pagina - 1 : etapa.pagina);

    totalPaginasEstimadas += Math.max(1, estimadas);

    if (etapa.concluida) {
      paginasConcluidas += Math.max(1, etapa.pagina - 1);
    } else {
      paginasConcluidas += Math.max(0, etapa.pagina - 1);
    }
  }

  if (totalPaginasEstimadas === 0) return 0;

  return Math.min(
    99,
    Math.floor(
      (paginasConcluidas / totalPaginasEstimadas) * 100
    )
  );
}

function contarPaginasConcluidas(job) {
  return job.etapas.reduce(
    (total, etapa) => total + Math.max(0, etapa.pagina - 1),
    0
  );
}

function contarPaginasEstimadas(job) {
  return job.etapas.reduce((total, etapa) => {
    return total + (
      etapa.totalPaginas ||
      (etapa.concluida ? etapa.pagina - 1 : etapa.pagina)
    );
  }, 0);
}

function serializarJob(job) {
  const etapaAtual = job.etapas[job.etapaAtual] || null;

  return {
    id: job.id,
    status: job.status,
    progresso:
      job.status === 'completed'
        ? 100
        : calcularProgresso(job),
    paginasConcluidas: contarPaginasConcluidas(job),
    paginasEstimadas: contarPaginasEstimadas(job),
    totalResultados: job.resultados.length,
    data: job.resultados,
    erro: job.erro,
    proximaTentativaEm: job.proximaTentativaEm
      ? new Date(job.proximaTentativaEm).toISOString()
      : null,
    modalidades: job.filtros.modalidades,
    todasModalidades: job.filtros.modalidades.length === 0,
    etapaAtual: etapaAtual
      ? {
          fonte: etapaAtual.fonte,
          modalidade: etapaAtual.modalidade,
          pagina: etapaAtual.pagina,
          totalPaginas: etapaAtual.totalPaginas,
        }
      : null,
  };
}

// ============================================================
// CONTROLE DE JOBS
// ============================================================

function removerJobDaFila(jobId) {
  for (let i = filaJobs.length - 1; i >= 0; i -= 1) {
    if (filaJobs[i] === jobId) {
      filaJobs.splice(i, 1);
    }
  }
}

function adicionarNaFila(job) {
  if (
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled'
  ) {
    return;
  }

  if (job.naFila) return;

  job.naFila = true;
  job.status = 'queued';
  filaJobs.push(job.id);

  processarFilaJobs();
}

function finalizarJob(job, status, erro = null) {
  job.status = status;
  job.erro = erro;
  job.proximaTentativaEm = null;
  job.finalizadoEm = Date.now();
  job.atualizadoEm = Date.now();

  removerJobDaFila(job.id);
}

function agendarRetomada(job, esperaMs, erro) {
  job.status = 'paused';
  job.erro = erro.message;
  job.proximaTentativaEm = Date.now() + esperaMs;
  job.atualizadoEm = Date.now();
  job.naFila = false;

  console.warn(
    `[PNCP] Pesquisa ${job.id} pausada por limite de requisições. ` +
    `Retomada prevista em ${Math.ceil(esperaMs / 1000)} segundos.`
  );

  setTimeout(() => {
    const jobAtual = jobs.get(job.id);

    if (!jobAtual || jobAtual.status !== 'paused') return;

    jobAtual.erro = null;
    jobAtual.proximaTentativaEm = null;

    adicionarNaFila(jobAtual);
  }, esperaMs);
}

async function processarJob(job) {
  job.status = 'running';
  job.atualizadoEm = Date.now();
  job.erro = null;

  logDebug('Pesquisa iniciada', {
    id: job.id,
    dataInicial: job.filtros.dataInicial,
    dataFinal: job.filtros.dataFinal,
    uf: job.filtros.uf || '(todas)',
    termo: job.filtros.termo || '(nenhum)',
    modalidades: job.filtros.modalidades,
    quantidadeEtapas: job.etapas.length,
  });

  try {
    while (job.etapaAtual < job.etapas.length) {
      const etapa = job.etapas[job.etapaAtual];

      if (etapa.concluida) {
        job.etapaAtual += 1;
        continue;
      }

      if (etapa.pagina > MAX_PAGINAS_CONSULTA) {
        throw new Error(
          `A etapa excedeu o limite de ${MAX_PAGINAS_CONSULTA} páginas.`
        );
      }

      job.atualizadoEm = Date.now();

      const parametros = montarParametros(etapa, job.filtros);

      logDebug('Processando etapa', {
        jobId: job.id,
        indiceEtapa: job.etapaAtual + 1,
        totalEtapas: job.etapas.length,
        fonte: etapa.fonte,
        modalidade: etapa.modalidade,
        pagina: etapa.pagina,
        parametros,
      });

      const resposta = await consultarEtapa(etapa, job.filtros);
      const registros = extrairRegistros(resposta);
      const totalPaginas = extrairTotalPaginas(resposta);

      const resumoResultados = adicionarResultados(job, registros);

      if (totalPaginas !== null) {
        etapa.totalPaginas = totalPaginas;
      }

      logDebug('Resultado da etapa', {
        jobId: job.id,
        fonte: etapa.fonte,
        modalidade: etapa.modalidade,
        pagina: etapa.pagina,
        dataInicial: parametros.dataInicial || null,
        dataFinal: parametros.dataFinal || null,
        totalRegistrosInformado: resposta?.totalRegistros ?? null,
        totalPaginasInformado: totalPaginas,
        ...resumoResultados,
        termoAplicado: job.filtros.termo || '(nenhum)',
      });

      const temMaisPaginas =
        etapa.totalPaginas !== null
          ? etapa.pagina < etapa.totalPaginas
          : registros.length >= TAMANHO_PAGINA;

      job.atualizadoEm = Date.now();

      if (!temMaisPaginas || registros.length === 0) {
        etapa.concluida = true;

        logDebug('Etapa concluída', {
          jobId: job.id,
          fonte: etapa.fonte,
          modalidade: etapa.modalidade,
          pagina: etapa.pagina,
          registrosNaPagina: registros.length,
          totalPaginas: etapa.totalPaginas,
        });

        job.etapaAtual += 1;
      } else {
        etapa.pagina += 1;
      }
    }

    finalizarJob(job, 'completed');

    console.info(
      `[PNCP] Pesquisa ${job.id} concluída. ` +
      `${job.resultados.length} resultado(s).`
    );

    logDebug('Resumo final da pesquisa', {
      jobId: job.id,
      status: job.status,
      totalResultados: job.resultados.length,
      quantidadeEtapas: job.etapas.length,
      fontesConsultadas: job.etapas.reduce((acc, etapa) => {
        acc[etapa.fonte] = (acc[etapa.fonte] || 0) + 1;
        return acc;
      }, {}),
      etapasSemResultados: job.etapas.filter(
        (etapa) => etapa.concluida
      ).length,
    });
  } catch (erro) {
    if (erro.status === 429 || erro.response?.status === 429) {
      const esperaMs =
        erro.retryAfterMs || ESPERA_RATE_LIMIT_MS;

      agendarRetomada(job, esperaMs, erro);
      return;
    }

    finalizarJob(
      job,
      'failed',
      erro.message || 'Erro desconhecido ao consultar o PNCP.'
    );

    console.error(
      `[PNCP] Pesquisa ${job.id} falhou:`,
      erro.message
    );
  }
}

async function processarFilaJobs() {
  if (processamentoFilaAtivo) return;

  processamentoFilaAtivo = true;

  try {
    while (filaJobs.length > 0) {
      const jobId = filaJobs.shift();
      const job = jobs.get(jobId);

      if (!job) continue;

      job.naFila = false;

      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'cancelled' ||
        job.status === 'paused'
      ) {
        continue;
      }

      await processarJob(job);
    }
  } finally {
    processamentoFilaAtivo = false;

    if (filaJobs.length > 0) {
      processarFilaJobs();
    }
  }
}

function limparJobsAntigos() {
  const agora = Date.now();

  for (const [id, job] of jobs.entries()) {
    if (
      job.finalizadoEm &&
      agora - job.finalizadoEm > JOB_RETENTION_MS
    ) {
      jobs.delete(id);
      removerJobDaFila(id);
    }
  }

  for (const [chave, registro] of cachePaginas.entries()) {
    if (agora - registro.criadoEm > CACHE_TTL_MS) {
      cachePaginas.delete(chave);
    }
  }
}

const intervaloLimpeza = setInterval(
  limparJobsAntigos,
  5 * 60 * 1000
);

if (typeof intervaloLimpeza.unref === 'function') {
  intervaloLimpeza.unref();
}

// ============================================================
// ENDPOINT 1: PESQUISA DIRETA
// GET /api/pncp/search
// ============================================================

async function searchPncpBids(req, res) {
  try {
    const filtros = obterFiltros({
      ...req.query,
      modalidades:
        req.query.modalidades !== undefined
          ? req.query.modalidades
          : req.query.modalidade,
    });

    const pagina = Math.max(
      1,
      Number.parseInt(req.query.pagina, 10) || 1
    );

    const modalidadeUnica =
      filtros.modalidades.length === 1
        ? filtros.modalidades[0]
        : null;

    const etapa = {
      fonte: 'proposta',
      modalidade: modalidadeUnica,
      pagina,
    };

    logDebug('Pesquisa direta solicitada', {
      filtros,
      pagina,
    });

    const resposta = await consultarEtapa(etapa, filtros);
    const registrosBrutos = extrairRegistros(resposta);

    const registros = registrosBrutos.filter((item) =>
      correspondeAoTermo(item, filtros.termo)
    );

    logDebug('Resultado da pesquisa direta', {
      registrosBrutos: registrosBrutos.length,
      registrosApósFiltro: registros.length,
      totalRegistrosInformado: resposta?.totalRegistros ?? null,
      totalPaginas: extrairTotalPaginas(resposta),
      termo: filtros.termo || '(nenhum)',
    });

    return res.json({
      data: registros,
      pagina,
      totalPaginas: extrairTotalPaginas(resposta),
      totalResultados: registros.length,
      fonte: 'proposta',
      aviso:
        filtros.modalidades.length > 1
          ? 'A pesquisa direta consulta apenas a fonte de propostas e não combina todas as modalidades. ' +
            'Use POST /api/pncp/search/jobs para uma pesquisa completa.'
          : null,
    });
  } catch (erro) {
    const status =
      erro.status ||
      erro.response?.status ||
      500;

    return res.status(status).json({
      erro: erro.message || 'Erro ao consultar o PNCP.',
      status,
      retryAfterMs: erro.retryAfterMs || null,
    });
  }
}

// ============================================================
// ENDPOINT 2: INICIAR PESQUISA EM SEGUNDO PLANO
// POST /api/pncp/search/jobs
// ============================================================

async function startPncpSearch(req, res) {
  try {
    const filtros = obterFiltros({
      ...req.body,
      modalidades:
        req.body.modalidades !== undefined
          ? req.body.modalidades
          : req.body.modalidade,
    });

    const etapas = await criarEtapas(filtros);
    const id = crypto.randomUUID();

    const job = {
      id,
      status: 'queued',
      filtros,
      etapas,
      etapaAtual: 0,
      resultados: [],
      idsResultados: new Set(),
      erro: null,
      proximaTentativaEm: null,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      finalizadoEm: null,
      naFila: false,
    };

    jobs.set(id, job);

    logDebug('Job criado', {
      id,
      dataInicial: filtros.dataInicial,
      dataFinal: filtros.dataFinal,
      uf: filtros.uf || '(todas)',
      termo: filtros.termo || '(nenhum)',
      modalidades: filtros.modalidades,
      quantidadeEtapas: etapas.length,
    });

    adicionarNaFila(job);

    return res.status(202).json({
      mensagem: 'Pesquisa iniciada.',
      ...serializarJob(job),
    });
  } catch (erro) {
    console.error('[PNCP] Erro ao iniciar pesquisa:', erro.message);

    return res.status(400).json({
      erro: erro.message || 'Não foi possível iniciar a pesquisa.',
    });
  }
}

// ============================================================
// ENDPOINT 3: CONSULTAR ESTADO DA PESQUISA
// GET /api/pncp/search/jobs/:id
// ============================================================

function getPncpSearchJob(req, res) {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      erro:
        'Pesquisa não encontrada. Ela pode ter expirado ou a instância da API pode ter reiniciado.',
    });
  }

  return res.json(serializarJob(job));
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
};
