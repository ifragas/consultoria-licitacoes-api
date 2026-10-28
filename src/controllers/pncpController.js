
const axios = require('axios');
const crypto = require('crypto');

const PNCP_BASE_URL = 'https://pncp.gov.br/api/consulta/v1';
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
const DEBUG_PNCP = process.env.DEBUG_PNCP === 'true';

const cachePaginas = new Map();
const jobs = new Map();
const filaJobs = [];

let processamentoFilaAtivo = false;
let ultimaRequisicaoPncp = 0;
let bloqueioPncpAte = 0;
let filaPncp = Promise.resolve();
let cacheModalidades = null;
let cacheModalidadesCriadoEm = 0;

function logDebug(...args) {
  if (DEBUG_PNCP) console.info('[PNCP][DEBUG]', ...args);
}

function dormir(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, ms))
  );
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

  if (/^\d{8}$/.test(valor)) return valor;

  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor.replace(/-/g, '');
  }

  return null;
}

function validarData(data) {
  if (!/^\d{8}$/.test(String(data || ''))) return false;

  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(4, 6));
  const dia = Number(data.slice(6, 8));

  if (ano < 2000 || mes < 1 || mes > 12 || dia < 1) {
    return false;
  }

  const d = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    d.getUTCFullYear() === ano &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}

function dataHojeFormatoPncp() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value])
  );

  return `${valores.year}${valores.month}${valores.day}`;
}

function dataDiasDepoisFormatoPncp(dataBase, dias) {
  const data = new Date(
    Date.UTC(
      Number(dataBase.slice(0, 4)),
      Number(dataBase.slice(4, 6)) - 1,
      Number(dataBase.slice(6, 8))
    )
  );

  data.setUTCDate(data.getUTCDate() + dias);

  return (
    `${data.getUTCFullYear()}` +
    `${String(data.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(data.getUTCDate()).padStart(2, '0')}`
  );
}

function obterModalidades(entrada = {}) {
  let valores = entrada.modalidades;

  if (valores == null) {
    valores =
      entrada.modalidade != null && entrada.modalidade !== ''
        ? [entrada.modalidade]
        : [];
  }

  if (typeof valores === 'string') {
    valores = valores
      .split(',')
      .map((valor) => valor.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(valores)) valores = [valores];

  return [
    ...new Set(
      valores
        .map(Number)
        .filter((valor) => Number.isInteger(valor) && valor > 0)
    ),
  ];
}

function obterFiltros(entrada = {}) {
  const inicialInformada = normalizarData(entrada.dataInicial);
  const finalInformada = normalizarData(entrada.dataFinal);

  if (entrada.dataInicial && !inicialInformada) {
    throw new Error(
      'Data inicial inválida. Utilize AAAA-MM-DD ou AAAAMMDD.'
    );
  }

  if (entrada.dataFinal && !finalInformada) {
    throw new Error(
      'Data final inválida. Utilize AAAA-MM-DD ou AAAAMMDD.'
    );
  }

  if (inicialInformada && !validarData(inicialInformada)) {
    throw new Error('A data inicial não é uma data válida.');
  }

  if (finalInformada && !validarData(finalInformada)) {
    throw new Error('A data final não é uma data válida.');
  }

  const hoje = dataHojeFormatoPncp();
  const dataInicial = inicialInformada || hoje;
  const dataFinal =
    finalInformada || dataDiasDepoisFormatoPncp(dataInicial, 30);

  if (dataInicial > dataFinal) {
    throw new Error(
      'A data inicial não pode ser posterior à data final.'
    );
  }

  const uf = String(entrada.uf || '').trim().toUpperCase();

  if (uf && !/^[A-Z]{2}$/.test(uf)) {
    throw new Error(
      'UF inválida. Informe uma sigla de dois caracteres.'
    );
  }

  return {
    dataInicial,
    dataFinal,
    uf,
    modalidades: obterModalidades(entrada),
    termo: String(entrada.termo || '').trim(),
  };
}

function extrairRegistros(resposta) {
  if (Array.isArray(resposta)) return resposta;
  if (Array.isArray(resposta?.data)) return resposta.data;
  if (Array.isArray(resposta?.items)) return resposta.items;
  if (Array.isArray(resposta?.content)) return resposta.content;

  if (Array.isArray(resposta?.data?.content)) {
    return resposta.data.content;
  }

  return [];
}

function extrairTotalPaginas(resposta) {
  const valores = [
    resposta?.totalPaginas,
    resposta?.totalPages,
    resposta?.total_pages,
    resposta?.pagination?.totalPages,
    resposta?.paginacao?.totalPaginas,
  ];

  for (const valor of valores) {
    const numero = Number(valor);

    if (Number.isInteger(numero) && numero >= 0) {
      return numero;
    }
  }

  return null;
}

function normalizarDataCampo(valor) {
  if (!valor) return null;

  const texto = String(valor).trim();

  let resultado = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (resultado) {
    return `${resultado[1]}${resultado[2]}${resultado[3]}`;
  }

  resultado = texto.match(/^(\d{4})(\d{2})(\d{2})/);

  if (resultado) {
    return `${resultado[1]}${resultado[2]}${resultado[3]}`;
  }

  resultado = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

  if (resultado) {
    return `${resultado[3]}${resultado[2]}${resultado[1]}`;
  }

  return null;
}

function obterDataEncerramentoProposta(item) {
  const candidatos = [
    item?.dataEncerramentoProposta,
    item?.dataFimRecebimentoPropostas,
    item?.dataEncerramentoRecebimentoPropostas,
    item?.dataFinalRecebimentoProposta,
    item?.dataHoraFimRecebimentoPropostas,
    item?.dataFimProposta,
  ];

  for (const valor of candidatos) {
    const data = normalizarDataCampo(valor);

    if (data && validarData(data)) return data;
  }

  return null;
}

function correspondeAoPrazo(item, filtros) {
  const encerramento = obterDataEncerramentoProposta(item);

  return Boolean(
    encerramento &&
    encerramento >= filtros.dataInicial &&
    encerramento <= filtros.dataFinal
  );
}

function extrairIdentificador(item) {
  const cnpj = item?.orgaoEntidade?.cnpj;
  const ano = item?.anoCompra;
  const sequencial = item?.sequencialCompra;

  if (cnpj && ano && sequencial) {
    return `${cnpj}-${ano}-${sequencial}`;
  }

  const controle =
    item?.numeroControlePNCP ||
    item?.numeroControlePncp ||
    item?.id;

  if (controle) return String(controle);

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
  return (
    !termo ||
    normalizarTexto(obterTextoPesquisa(item)).includes(
      normalizarTexto(termo)
    )
  );
}

function obterRetryAfterMs(headers = {}) {
  const valor = headers['retry-after'] ?? headers['Retry-After'];

  if (valor == null) return ESPERA_RATE_LIMIT_MS;

  const segundos = Number(valor);

  if (Number.isFinite(segundos) && segundos >= 0) {
    return Math.max(ESPERA_RATE_LIMIT_MS, segundos * 1000);
  }

  const dataRetry = Date.parse(String(valor));

  return Number.isFinite(dataRetry)
    ? Math.max(ESPERA_RATE_LIMIT_MS, dataRetry - Date.now())
    : ESPERA_RATE_LIMIT_MS;
}

function criarErroHttp(mensagem, status, detalhes = {}) {
  const erro = new Error(mensagem);
  erro.status = status;
  Object.assign(erro, detalhes);
  return erro;
}

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
  let espera = Math.max(0, bloqueioPncpAte - Date.now());

  if (espera > 0) await dormir(espera);

  espera =
    INTERVALO_REQUISICOES_MS -
    (Date.now() - ultimaRequisicaoPncp);

  if (espera > 0) await dormir(espera);

  espera = Math.max(0, bloqueioPncpAte - Date.now());

  if (espera > 0) await dormir(espera);

  ultimaRequisicaoPncp = Date.now();
}

function executarNaFilaPncp(funcao) {
  const execucao = filaPncp.then(funcao, funcao);
  filaPncp = execucao.catch(() => {});
  return execucao;
}

async function requisitarPncp(url, parametros = {}, opcoes = {}) {
  const chave = JSON.stringify({
    url,
    parametros,
    metodo: 'GET',
  });

  if (!opcoes.ignorarCache) {
    const cacheado = obterCache(chave);
    if (cacheado !== null) return cacheado;
  }

  return executarNaFilaPncp(async () => {
    if (!opcoes.ignorarCache) {
      const cacheado = obterCache(chave);
      if (cacheado !== null) return cacheado;
    }

    let ultimaFalha;

    for (
      let tentativa = 1;
      tentativa <= MAX_TENTATIVAS;
      tentativa += 1
    ) {
      await respeitarLimitePncp();

      try {
        logDebug('Requisição PNCP', {
          endpoint: url,
          pagina: parametros.pagina,
          tentativa,
        });

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

          throw criarErroHttp(
            `O PNCP limitou as requisições. Nova tentativa em aproximadamente ${Math.ceil(
              esperaMs / 1000
            )} segundos.`,
            429,
            { retryAfterMs: esperaMs }
          );
        }

        if (resposta.status < 200 || resposta.status >= 300) {
          throw criarErroHttp(
            `O PNCP respondeu com HTTP ${resposta.status}.`,
            resposta.status
          );
        }

        salvarCache(chave, resposta.data);
        return resposta.data;
      } catch (erro) {
        ultimaFalha = erro;

        if (erro.status === 429 || erro.response?.status === 429) {
          throw erro;
        }

        const status = erro.status || erro.response?.status;

        if (status >= 400 && status < 500 && status !== 408) {
          throw erro;
        }

        if (tentativa < MAX_TENTATIVAS) {
          await dormir(Math.min(2000 * tentativa, 10000));
        }
      }
    }

    throw ultimaFalha || new Error('Falha ao consultar o PNCP.');
  });
}

async function obterTodasModalidadesAtivas() {
  if (
    cacheModalidades &&
    Date.now() - cacheModalidadesCriadoEm < 6 * 60 * 60 * 1000
  ) {
    return cacheModalidades;
  }

  const resposta = await requisitarPncp(
    URL_MODALIDADES,
    { statusAtivo: true }
  );

  const modalidades = [
    ...new Set(
      extrairRegistros(resposta)
        .filter((item) => item?.statusAtivo !== false)
        .map((item) => Number(item?.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!modalidades.length) {
    throw new Error(
      'Não foi possível obter as modalidades ativas do PNCP. Selecione uma modalidade e tente novamente.'
    );
  }

  cacheModalidades = modalidades;
  cacheModalidadesCriadoEm = Date.now();

  return modalidades;
}

async function criarEtapas(filtros) {
  const modalidades = filtros.modalidades.length
    ? filtros.modalidades
    : await obterTodasModalidadesAtivas();

  return modalidades.map((modalidade) => ({
    fonte: 'proposta',
    modalidade,
    pagina: 1,
    totalPaginas: null,
    concluida: false,
    registrosRecebidos: 0,
    resultadosNoPrazo: 0,
    semDataEncerramento: 0,
    foraDoPrazo: 0,
  }));
}

function montarParametros(etapa, filtros) {
  const parametros = {
    pagina: etapa.pagina,
    tamanhoPagina: TAMANHO_PAGINA,
    dataFinal: filtros.dataFinal,
  };

  if (etapa.modalidade) {
    parametros.codigoModalidadeContratacao = etapa.modalidade;
  }

  if (filtros.uf) parametros.uf = filtros.uf;

  return parametros;
}

async function consultarEtapa(etapa, filtros) {
  return requisitarPncp(
    URL_PROPOSTA,
    montarParametros(etapa, filtros)
  );
}

function adicionarResultados(job, registros, etapa) {
  let correspondentesAoTermo = 0;
  let novosResultados = 0;
  let duplicados = 0;
  let semDataEncerramento = 0;
  let foraDoPrazo = 0;

  etapa.registrosRecebidos += registros.length;

  for (const item of registros) {
    if (!item || typeof item !== 'object') continue;

    const data = obterDataEncerramentoProposta(item);

    if (!data) {
      semDataEncerramento += 1;
      continue;
    }

    if (
      data < job.filtros.dataInicial ||
      data > job.filtros.dataFinal
    ) {
      foraDoPrazo += 1;
      continue;
    }

    if (!correspondeAoTermo(item, job.filtros.termo)) continue;

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

  etapa.resultadosNoPrazo += correspondentesAoTermo;
  etapa.semDataEncerramento += semDataEncerramento;
  etapa.foraDoPrazo += foraDoPrazo;

  return {
    registrosRecebidos: registros.length,
    correspondentesAoTermo,
    novosResultados,
    duplicados,
    semDataEncerramento,
    foraDoPrazo,
    totalAcumulado: job.resultados.length,
  };
}

function contarPaginasConcluidas(job) {
  return job.etapas.reduce(
    (total, etapa) =>
      total +
      (etapa.concluida
        ? etapa.pagina
        : Math.max(0, etapa.pagina - 1)),
    0
  );
}

function contarPaginasEstimadas(job) {
  return job.etapas.reduce(
    (total, etapa) =>
      total +
      (etapa.totalPaginas ||
        (etapa.concluida
          ? Math.max(1, etapa.pagina)
          : etapa.pagina)),
    0
  );
}

function calcularProgresso(job) {
  if (!job.etapas.length) return 0;

  const total = contarPaginasEstimadas(job);

  return total
    ? Math.min(
        99,
        Math.floor((contarPaginasConcluidas(job) / total) * 100)
      )
    : 0;
}

function serializarJob(job) {
  const etapa = job.etapas[job.etapaAtual] || null;

  return {
    id: job.id,
    status: job.status,
    progresso: job.status === 'completed' ? 100 : calcularProgresso(job),
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
    etapaAtual: etapa
      ? {
          fonte: etapa.fonte,
          modalidade: etapa.modalidade,
          pagina: etapa.pagina,
          totalPaginas: etapa.totalPaginas,
        }
      : null,
    resumoFontes: job.resumoFontes || null,
  };
}

function removerJobDaFila(id) {
  for (let i = filaJobs.length - 1; i >= 0; i -= 1) {
    if (filaJobs[i] === id) filaJobs.splice(i, 1);
  }
}

function adicionarNaFila(job) {
  if (
    ['completed', 'failed', 'cancelled'].includes(job.status) ||
    job.naFila
  ) {
    return;
  }

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
    `[PNCP] Pesquisa ${job.id} pausada por rate limit; retomada em ${Math.ceil(
      esperaMs / 1000
    )}s.`
  );

  setTimeout(() => {
    const atual = jobs.get(job.id);

    if (!atual || atual.status !== 'paused') return;

    atual.erro = null;
    atual.proximaTentativaEm = null;

    adicionarNaFila(atual);
  }, esperaMs);
}

async function processarJob(job) {
  job.status = 'running';
  job.atualizadoEm = Date.now();
  job.erro = null;

  console.info(
    `[PNCP] Pesquisa ${job.id} iniciada: prazo ${job.filtros.dataInicial} a ${job.filtros.dataFinal}; ${job.etapas.length} modalidade(s).`
  );

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

      const resposta = await consultarEtapa(etapa, job.filtros);
      const registros = extrairRegistros(resposta);

      etapa.totalPaginas = extrairTotalPaginas(resposta);

      const resumo = adicionarResultados(job, registros, etapa);

      if (etapa.pagina === 1 || etapa.pagina % 10 === 0) {
        logDebug('Progresso', {
          jobId: job.id,
          modalidade: etapa.modalidade,
          pagina: etapa.pagina,
          totalPaginas: etapa.totalPaginas,
          ...resumo,
        });
      }

      const temMais =
        etapa.totalPaginas != null
          ? etapa.pagina < etapa.totalPaginas
          : registros.length >= TAMANHO_PAGINA;

      job.atualizadoEm = Date.now();

      if (!temMais || registros.length === 0) {
        etapa.concluida = true;
        job.etapaAtual += 1;
      } else {
        etapa.pagina += 1;
      }
    }

    job.resumoFontes = {
      proposta: {
        etapas: job.etapas.length,
        paginasConsultadas: job.etapas.reduce(
          (total, etapa) =>
            total +
            (etapa.concluida
              ? etapa.pagina
              : Math.max(0, etapa.pagina - 1)),
          0
        ),
        registrosRecebidos: job.etapas.reduce(
          (total, etapa) => total + etapa.registrosRecebidos,
          0
        ),
        resultadosNoPrazo: job.etapas.reduce(
          (total, etapa) => total + etapa.resultadosNoPrazo,
          0
        ),
        semDataEncerramento: job.etapas.reduce(
          (total, etapa) => total + etapa.semDataEncerramento,
          0
        ),
        foraDoPrazo: job.etapas.reduce(
          (total, etapa) => total + etapa.foraDoPrazo,
          0
        ),
        etapasSemResultados: job.etapas.filter(
          (etapa) => etapa.resultadosNoPrazo === 0
        ).length,
      },
    };

    finalizarJob(job, 'completed');

    console.info(
      `[PNCP] Pesquisa ${job.id} concluída: ${job.resultados.length} resultado(s).`,
      job.resumoFontes
    );
  } catch (erro) {
    if (erro.status === 429 || erro.response?.status === 429) {
      agendarRetomada(
        job,
        erro.retryAfterMs || ESPERA_RATE_LIMIT_MS,
        erro
      );
      return;
    }

    finalizarJob(
      job,
      'failed',
      erro.message || 'Erro desconhecido ao consultar o PNCP.'
    );

    console.error(`[PNCP] Pesquisa ${job.id} falhou:`, erro.message);
  }
}

async function processarFilaJobs() {
  if (processamentoFilaAtivo) return;

  processamentoFilaAtivo = true;

  try {
    while (filaJobs.length) {
      const id = filaJobs.shift();
      const job = jobs.get(id);

      if (!job) continue;

      job.naFila = false;

      if (
        ['completed', 'failed', 'cancelled', 'paused'].includes(job.status)
      ) {
        continue;
      }

      await processarJob(job);
    }
  } finally {
    processamentoFilaAtivo = false;

    if (filaJobs.length) processarFilaJobs();
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

async function searchPncpBids(req, res) {
  try {
    const filtros = obterFiltros({
      ...req.query,
      modalidades: req.query.modalidades ?? req.query.modalidade,
    });

    const pagina = Math.max(
      1,
      Number.parseInt(req.query.pagina, 10) || 1
    );

    if (filtros.modalidades.length > 1) {
      return res.status(400).json({
        erro: 'A pesquisa direta aceita uma modalidade por vez. Use POST /api/pncp/search/jobs para combinar modalidades.',
      });
    }

    const etapa = {
      fonte: 'proposta',
      modalidade: filtros.modalidades[0] || null,
      pagina,
    };

    const resposta = await consultarEtapa(etapa, filtros);
    const brutos = extrairRegistros(resposta);

    const data = brutos.filter(
      (item) =>
        correspondeAoPrazo(item, filtros) &&
        correspondeAoTermo(item, filtros.termo)
    );

    return res.json({
      data,
      pagina,
      totalPaginas: extrairTotalPaginas(resposta),
      totalResultados: data.length,
      fonte: 'proposta',
      filtrosPrazo: {
        dataInicial: filtros.dataInicial,
        dataFinal: filtros.dataFinal,
      },
    });
  } catch (erro) {
    const status = erro.status || erro.response?.status || 500;

    return res.status(status).json({
      erro: erro.message || 'Erro ao consultar o PNCP.',
      status,
      retryAfterMs: erro.retryAfterMs || null,
    });
  }
}

async function startPncpSearch(req, res) {
  try {
    const filtros = obterFiltros({
      ...req.body,
      modalidades: req.body.modalidades ?? req.body.modalidade,
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
      resumoFontes: null,
    };

    jobs.set(id, job);
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

function getPncpSearchJob(req, res) {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      erro: 'Pesquisa não encontrada. Ela pode ter expirado ou a instância da API pode ter reiniciado.',
    });
  }

  return res.json(serializarJob(job));
}

module.exports = {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
};
