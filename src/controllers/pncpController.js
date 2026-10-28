
const crypto = require('crypto');
const PncpBid = require('../models/PncpBid');

const JOB_RETENTION_MS = 30 * 60 * 1000;
const TAMANHO_LOTE_JOB = 500;

const jobs = new Map();
const filaJobs = [];

let processamentoFilaAtivo = false;

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

  const dataValidacao = new Date(
    Date.UTC(ano, mes - 1, dia)
  );

  return (
    dataValidacao.getUTCFullYear() === ano &&
    dataValidacao.getUTCMonth() === mes - 1 &&
    dataValidacao.getUTCDate() === dia
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
        .filter(
          (valor) =>
            Number.isInteger(valor) && valor > 0
        )
    ),
  ];
}

/**
 * Separa palavras-chave por vírgulas, ponto e vírgula,
 * quebras de linha, barras verticais e outros separadores.
 *
 * Expressões entre aspas permanecem juntas.
 * Espaços fora das aspas também separam termos.
 *
 * Exemplos:
 * drenagem, terraplenagem
 * "medicina do trabalho"; pavimentação
 * areia brita basalto
 */
function separarTermosPesquisa(entrada) {
  const texto = String(entrada ?? '').trim();

  if (!texto) return [];

  const termos = [];
  let atual = '';
  let aspas = null;

  const separadores = new Set([
    ',',
    ';',
    '\n',
    '\r',
    '|',
    '\t',
  ]);

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i];

    const ehAspa =
      caractere === '"' ||
      caractere === "'" ||
      caractere === '“' ||
      caractere === '”' ||
      caractere === '‘' ||
      caractere === '’';

    if (ehAspa) {
      if (aspas === null) {
        aspas = caractere;
        continue;
      }

      const fechaAspas =
        (aspas === '"' && (caractere === '"' || caractere === '”')) ||
        (aspas === "'" && (caractere === "'" || caractere === '’')) ||
        (aspas === '“' && caractere === '”') ||
        (aspas === '‘' && caractere === '’');

      if (fechaAspas) {
        aspas = null;
        continue;
      }
    }

    if (aspas === null && separadores.has(caractere)) {
      if (atual.trim()) termos.push(atual.trim());
      atual = '';
      continue;
    }

    if (aspas === null && /\s/.test(caractere)) {
      if (atual.trim()) termos.push(atual.trim());
      atual = '';
      continue;
    }

    atual += caractere;
  }

  if (atual.trim()) termos.push(atual.trim());

  // Remove duplicatas sem diferenciar maiúsculas/minúsculas.
  const termosUnicos = [];
  const vistos = new Set();

  for (const termo of termos) {
    const chave = termo.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (!chave || vistos.has(chave)) continue;

    vistos.add(chave);
    termosUnicos.push(termo);
  }

  return termosUnicos;
}

function obterFiltros(entrada = {}) {
  const inicialInformada = normalizarData(
    entrada.dataInicial
  );

  const finalInformada = normalizarData(
    entrada.dataFinal
  );

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

  if (
    inicialInformada &&
    !validarData(inicialInformada)
  ) {
    throw new Error('A data inicial não é válida.');
  }

  if (
    finalInformada &&
    !validarData(finalInformada)
  ) {
    throw new Error('A data final não é válida.');
  }

  const hoje = dataHojeFormatoPncp();
  const dataInicial = inicialInformada || hoje;

  const dataFinal =
    finalInformada ||
    dataDiasDepoisFormatoPncp(dataInicial, 30);

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

  const termoOriginal = String(entrada.termo || '').trim();

  return {
    dataInicial,
    dataFinal,
    uf,
    modalidades: obterModalidades(entrada),
    termo: termoOriginal,
    termos: separarTermosPesquisa(termoOriginal),
  };
}

function criarIntervaloDatas(filtros) {
  return {
    $gte: new Date(
      `${filtros.dataInicial.slice(0, 4)}-` +
      `${filtros.dataInicial.slice(4, 6)}-` +
      `${filtros.dataInicial.slice(6, 8)}T00:00:00.000Z`
    ),
    $lte: new Date(
      `${filtros.dataFinal.slice(0, 4)}-` +
      `${filtros.dataFinal.slice(4, 6)}-` +
      `${filtros.dataFinal.slice(6, 8)}T23:59:59.999Z`
    ),
  };
}

function escaparRegex(valor) {
  return String(valor).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}

function regexSemAcentos(termo) {
  const caracteres = {
    a: '[aáàâãä]',
    e: '[eéèêë]',
    i: '[iíìîï]',
    o: '[oóòôõö]',
    u: '[uúùûü]',
    c: '[cç]',
    n: '[nñ]',
  };

  const normalizado = String(termo)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const padrao = normalizado
    .split('')
    .map((caractere) => {
      if (caracteres[caractere]) {
        return caracteres[caractere];
      }

      return escaparRegex(caractere);
    })
    .join('');

  return new RegExp(padrao, 'i');
}

function construirConsulta(filtros) {
  const consulta = {
    dataAberturaProposta: criarIntervaloDatas(filtros),
  };

  if (filtros.uf) {
    consulta.uf = filtros.uf;
  }

  if (filtros.modalidades.length === 1) {
    consulta.modalidadeId = filtros.modalidades[0];
  } else if (filtros.modalidades.length > 1) {
    consulta.modalidadeId = {
      $in: filtros.modalidades,
    };
  }

  if (filtros.termos.length > 0) {
    const camposPesquisaveis = [
      'objetoCompra',
      'informacaoComplementar',
      'orgaoNome',
      'unidadeNome',
      'municipio',
      'modalidadeNome',
    ];

    // Cada termo pode corresponder a qualquer campo.
    // A consulta aceita um ou vários termos com lógica OU.
    consulta.$or = filtros.termos.flatMap((termo) => {
      const regex = regexSemAcentos(termo);

      return camposPesquisaveis.map((campo) => ({
        [campo]: regex,
      }));
    });
  }

  return consulta;
}

function converterParaRegistroPncp(documento) {
  const registro =
    typeof documento.toObject === 'function'
      ? documento.toObject()
      : documento;

  const original =
    registro.dadosOriginais &&
    typeof registro.dadosOriginais === 'object'
      ? registro.dadosOriginais
      : {};

  return {
    ...original,

    numeroControlePNCP: registro.numeroControlePNCP,
    objetoCompra: registro.objetoCompra || '',
    informacaoComplementar:
      registro.informacaoComplementar || '',

    modalidadeId: registro.modalidadeId,
    modalidadeNome: registro.modalidadeNome || '',

    orgaoEntidade: {
      ...(original.orgaoEntidade || {}),
      cnpj: registro.orgaoCnpj || '',
      razaoSocial: registro.orgaoNome || '',
    },

    unidadeOrgao: {
      ...(original.unidadeOrgao || {}),
      ufSigla: registro.uf || '',
      municipioNome: registro.municipio || '',
      nomeUnidade: registro.unidadeNome || '',
    },

    anoCompra: registro.anoCompra,
    sequencialCompra: registro.sequencialCompra,
    valorTotalEstimado: registro.valorTotalEstimado,

    dataPublicacaoPncp: registro.dataPublicacaoPncp
      ? new Date(registro.dataPublicacaoPncp)
          .toISOString()
          .replace('Z', '')
      : null,

    dataAberturaProposta: registro.dataAberturaProposta
      ? new Date(registro.dataAberturaProposta)
          .toISOString()
          .replace('Z', '')
      : null,

    dataEncerramentoProposta:
      registro.dataEncerramentoProposta
        ? new Date(registro.dataEncerramentoProposta)
            .toISOString()
            .replace('Z', '')
        : null,

    situacaoCompraNome: registro.situacaoCompra || '',
    linkSistemaOrigem: registro.urlPncp || '',
  };
}

function limparJobsAntigos() {
  const agora = Date.now();

  for (const [id, job] of jobs.entries()) {
    if (
      job.finalizadoEm &&
      agora - job.finalizadoEm > JOB_RETENTION_MS
    ) {
      jobs.delete(id);

      const indice = filaJobs.indexOf(id);

      if (indice !== -1) filaJobs.splice(indice, 1);
    }
  }
}

function contarPaginasConcluidas(job) {
  return Math.ceil(job.processados / TAMANHO_LOTE_JOB);
}

function calcularProgresso(job) {
  if (job.status === 'completed') return 100;
  if (!job.totalRegistros) return 0;

  return Math.min(
    99,
    Math.floor((job.processados / job.totalRegistros) * 100)
  );
}

function serializarJob(job) {
  return {
    id: job.id,
    status: job.status,
    progresso: calcularProgresso(job),
    paginasConcluidas: contarPaginasConcluidas(job),
    paginasEstimadas: Math.ceil(
      job.totalRegistros / TAMANHO_LOTE_JOB
    ),
    totalResultados: job.resultados.length,
    data: job.resultados,
    erro: job.erro,
    proximaTentativaEm: null,
    modalidades: job.filtros.modalidades,
    todasModalidades: job.filtros.modalidades.length === 0,
    etapaAtual: null,
    resumoFontes: {
      fonte: 'mongodb',
      totalEncontrado: job.totalRegistros,
      processados: job.processados,
    },
  };
}

function finalizarJob(job, status, erro = null) {
  job.status = status;
  job.erro = erro;
  job.finalizadoEm = Date.now();
  job.atualizadoEm = Date.now();
}

async function processarJob(job) {
  job.status = 'running';
  job.atualizadoEm = Date.now();

  try {
    const consulta = construirConsulta(job.filtros);

    job.totalRegistros = await PncpBid.countDocuments(consulta);

    for (
      let deslocamento = 0;
      deslocamento < job.totalRegistros;
      deslocamento += TAMANHO_LOTE_JOB
    ) {
      const lote = await PncpBid.find(consulta)
        .sort({
          dataAberturaProposta: 1,
          numeroControlePNCP: 1,
        })
        .skip(deslocamento)
        .limit(TAMANHO_LOTE_JOB)
        .lean();

      for (const registro of lote) {
        job.resultados.push(
          converterParaRegistroPncp(registro)
        );
      }

      job.processados += lote.length;
      job.atualizadoEm = Date.now();

      if (lote.length === 0) break;
    }

    finalizarJob(job, 'completed');
  } catch (erro) {
    console.error(
      `[PNCP DB] Erro na pesquisa ${job.id}:`,
      erro.message
    );

    finalizarJob(
      job,
      'failed',
      erro.message || 'Erro ao consultar o banco de dados.'
    );
  }
}

async function processarFilaJobs() {
  if (processamentoFilaAtivo) return;

  processamentoFilaAtivo = true;

  try {
    while (filaJobs.length > 0) {
      const id = filaJobs.shift();
      const job = jobs.get(id);

      if (!job || job.status !== 'queued') continue;

      await processarJob(job);
    }
  } finally {
    processamentoFilaAtivo = false;

    if (filaJobs.length > 0) {
      processarFilaJobs();
    }
  }
}

function adicionarNaFila(job) {
  if (job.status !== 'queued') return;

  filaJobs.push(job.id);
  processarFilaJobs();
}

async function searchPncpBids(req, res) {
  try {
    limparJobsAntigos();

    const filtros = obterFiltros({
      ...req.query,
      modalidades:
        req.query.modalidades ?? req.query.modalidade,
    });

    const pagina = Math.max(
      1,
      Number.parseInt(req.query.pagina, 10) || 1
    );

    const limiteSolicitado = Number.parseInt(
      req.query.limite,
      10
    );

    const limite =
      Number.isInteger(limiteSolicitado) && limiteSolicitado >= 1
        ? Math.min(limiteSolicitado, 100)
        : 50;

    const consulta = construirConsulta(filtros);

    const [totalRegistros, registros] = await Promise.all([
      PncpBid.countDocuments(consulta),

      PncpBid.find(consulta)
        .sort({
          dataAberturaProposta: 1,
          numeroControlePNCP: 1,
        })
        .skip((pagina - 1) * limite)
        .limit(limite)
        .lean(),
    ]);

    const totalPaginas = Math.ceil(totalRegistros / limite);

    return res.json({
      data: registros.map(converterParaRegistroPncp),
      pagina,
      limite,
      totalRegistros,
      totalPaginas,
      totalResultados: registros.length,
      fonte: 'mongodb',
      filtrosPrazo: {
        dataInicial: filtros.dataInicial,
        dataFinal: filtros.dataFinal,
      },
    });
  } catch (erro) {
    console.error('[PNCP DB] Erro na pesquisa:', erro);

    return res.status(400).json({
      erro: erro.message || 'Erro ao pesquisar oportunidades.',
    });
  }
}

async function startPncpSearch(req, res) {
  try {
    limparJobsAntigos();

    const filtros = obterFiltros({
      ...req.body,
      modalidades:
        req.body.modalidades ?? req.body.modalidade,
    });

    const job = {
      id: crypto.randomUUID(),
      status: 'queued',
      filtros,
      resultados: [],
      totalRegistros: 0,
      processados: 0,
      erro: null,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      finalizadoEm: null,
    };

    jobs.set(job.id, job);
    adicionarNaFila(job);

    return res.status(202).json({
      mensagem: 'Pesquisa iniciada no banco de dados.',
      ...serializarJob(job),
    });
  } catch (erro) {
    return res.status(400).json({
      erro: erro.message || 'Não foi possível iniciar a pesquisa.',
    });
  }
}

function getPncpSearchJob(req, res) {
  limparJobsAntigos();

  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      erro:
        'Pesquisa não encontrada. Ela pode ter expirado ou a API pode ter reiniciado.',
    });
  }

  return res.json(serializarJob(job));
}

const intervaloLimpeza = setInterval(
  limparJobsAntigos,
  5 * 60 * 1000
);

if (typeof intervaloLimpeza.unref === 'function') {
  intervaloLimpeza.unref();
}

module.exports = {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
};
