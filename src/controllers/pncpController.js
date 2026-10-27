
const axios = require('axios');

const PNCP_URL =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const TAMANHO_PAGINA = 50;
const TEMPO_CACHE_MS = 15 * 60 * 1000;
const INTERVALO_REQUISICOES_MS = 500;
const MAX_TENTATIVAS = 4;

// Cache temporário das páginas consultadas no PNCP.
const cachePaginas = new Map();

// Evita repetir imediatamente pesquisas completas idênticas.
const cachePesquisas = new Map();

// Fila global: somente uma requisição ao PNCP por vez.
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

function limparCachesExpirados() {
  const agora = Date.now();

  for (const [chave, item] of cachePaginas.entries()) {
    if (agora - item.timestamp > TEMPO_CACHE_MS) {
      cachePaginas.delete(chave);
    }
  }

  for (const [chave, item] of cachePesquisas.entries()) {
    if (agora - item.timestamp > TEMPO_CACHE_MS) {
      cachePesquisas.delete(chave);
    }
  }
}

function formatarData(data) {
  if (!data) return '';

  const valor = String(data).trim();

  // Aceita YYYY-MM-DD ou YYYYMMDD.
  if (/^\d{8}$/.test(valor)) {
    return valor;
  }

  const correspondencia = valor.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (correspondencia) {
    return `${correspondencia[1]}${correspondencia[2]}${correspondencia[3]}`;
  }

  return '';
}

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
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
    return entrada
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  const texto = String(entrada ?? '').trim();

  if (!texto) return [];

  // Aceita termos separados por vírgula e expressões entre aspas.
  const termos = [];
  const expressao = /"([^"]+)"|([^,]+)/g;
  let resultado;

  while ((resultado = expressao.exec(texto)) !== null) {
    const termo = (resultado[1] ?? resultado[2] ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();

    if (termo) termos.push(termo);
  }

  return [...new Set(termos)];
}

function normalizarModalidade(valor) {
  if (valor === undefined || valor === null) {
    return null;
  }

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

function chavePagina({
  dataInicial,
  dataFinal,
  uf,
  modalidade,
  pagina,
}) {
  return [
    dataInicial,
    dataFinal,
    uf || '',
    modalidade ?? 'todas',
    pagina,
  ].join('|');
}

function obterTotalPaginas(resposta) {
  const total = Number(
    resposta?.totalPaginas ??
    resposta?.totalPaginasEncontradas ??
    1
  );

  return Number.isFinite(total) && total >= 1
    ? Math.floor(total)
    : 1;
}

async function requisitarPaginaPncp(params) {
  const chave = chavePagina(params);
  limparCachesExpirados();

  const itemCache = cachePaginas.get(chave);

  if (itemCache && Date.now() - itemCache.timestamp < TEMPO_CACHE_MS) {
    return itemCache.dados;
  }

  return executarNaFila(async () => {
    // Outra consulta pode ter preenchido o cache enquanto aguardávamos.
    const cacheAtual = cachePaginas.get(chave);

    if (
      cacheAtual &&
      Date.now() - cacheAtual.timestamp < TEMPO_CACHE_MS
    ) {
      return cacheAtual.dados;
    }

    const parametros = {
      dataInicial: params.dataInicial,
      dataFinal: params.dataFinal,
      pagina: params.pagina,
      tamanhoPagina: TAMANHO_PAGINA,
    };

    if (params.uf) {
      parametros.uf = params.uf;
    }

    if (params.modalidade !== null && params.modalidade !== undefined) {
      parametros.codigoModalidadeContratacao = params.modalidade;
    }

    let ultimoErro;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      try {
        const resposta = await axios.get(PNCP_URL, {
          params: parametros,
          timeout: 25000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Gestorae/1.0',
          },
        });

        const dados = resposta.data;

        if (!dados || !Array.isArray(dados.data)) {
          throw new Error(
            'A API do PNCP retornou uma resposta em formato inesperado.'
          );
        }

        cachePaginas.set(chave, {
          timestamp: Date.now(),
          dados,
        });

        // Pausa entre chamadas para reduzir o risco de bloqueio.
        await aguardar(INTERVALO_REQUISICOES_MS);

        return dados;
      } catch (erro) {
        ultimoErro = erro;

        const status = erro.response?.status;
        const podeTentarNovamente =
          status === 429 ||
          status === 408 ||
          status >= 500 ||
          !erro.response;

        if (!podeTentarNovamente || tentativa === MAX_TENTATIVAS - 1) {
          break;
        }

        const retryAfter = Number(
          erro.response?.headers?.['retry-after']
        );

        // Se o servidor informar Retry-After, respeitamos o intervalo.
        // Caso contrário, usamos espera progressiva.
        const esperaMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2000 * (2 ** tentativa), 20000);

        await aguardar(esperaMs);
      }
    }

    const status = ultimoErro?.response?.status;

    const erroFinal = new Error(
      status === 429
        ? 'O PNCP está limitando as consultas. Aguarde alguns minutos e tente novamente; as páginas já armazenadas em cache serão reaproveitadas.'
        : `Falha ao consultar o PNCP${status ? ` (HTTP ${status})` : ''}: ${
            ultimoErro?.message || 'erro desconhecido'
          }`
    );

    erroFinal.status = status === 429 ? 429 : 502;
    erroFinal.original = ultimoErro;

    throw erroFinal;
  });
}

function removerDuplicatas(registros) {
  const vistos = new Set();

  return registros.filter((registro) => {
    const identificador =
      registro.numeroControlePNCP ||
      registro.id ||
      [
        registro.orgaoEntidade?.cnpj,
        registro.anoCompra,
        registro.sequencialCompra,
      ].filter(Boolean).join('-');

    if (!identificador) {
      // Sem identificador confiável, não descartamos o registro.
      return true;
    }

    if (vistos.has(identificador)) return false;

    vistos.add(identificador);
    return true;
  });
}

function filtrarPorTermos(registros, termos) {
  if (!termos.length) return registros;

  const termosNormalizados = termos
    .map(normalizarTexto)
    .filter(Boolean);

  return registros.filter((registro) => {
    const textoRegistro = normalizarTexto(
      [
        registro.objetoCompra,
        registro.informacaoComplementar,
        registro.modalidadeNome,
        registro.orgaoEntidade?.razaoSocial,
        registro.unidadeOrgao?.nomeUnidade,
        registro.unidadeOrgao?.municipioNome,
        registro.unidadeOrgao?.ufSigla,
      ]
        .filter(Boolean)
        .join(' ')
    );

    // Mantém a lógica OR: basta um dos termos corresponder.
    return termosNormalizados.some((termo) =>
      textoRegistro.includes(termo)
    );
  });
}

function chavePesquisa({
  dataInicial,
  dataFinal,
  uf,
  modalidade,
  termos,
}) {
  return JSON.stringify({
    dataInicial,
    dataFinal,
    uf: uf || '',
    modalidade: modalidade ?? 'todas',
    termos: termos.map(normalizarTexto).sort(),
  });
}

async function buscarTodasAsPaginas(filtros, totalPaginas) {
  const registros = [];

  // Sequencial, sem lotes paralelos.
  // As páginas já obtidas ficam em cache se uma chamada falhar.
  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    const resposta = await requisitarPaginaPncp({
      ...filtros,
      pagina,
    });

    registros.push(...resposta.data);

    // A quantidade real de páginas pode mudar entre consultas.
    if (pagina === 1) {
      totalPaginas = Math.min(
        obterTotalPaginas(resposta),
        1000
      );
    }
  }

  return removerDuplicatas(registros);
}

async function searchPncpBids(req, res) {
  try {
    const {
      termo = '',
      uf = '',
      modalidade,
      pagina = 1,
      dataInicial,
      dataFinal,
    } = req.query;

    const hoje = dataLocalISO();
    const dataPadraoFinal = new Date();
    dataPadraoFinal.setDate(dataPadraoFinal.getDate() + 30);

    const inicio = formatarData(dataInicial || hoje);
    const fim = formatarData(
      dataFinal || dataLocalISO(dataPadraoFinal)
    );

    if (!inicio || !fim) {
      return res.status(400).json({
        message: 'Informe as datas no formato YYYY-MM-DD.',
      });
    }

    if (inicio > fim) {
      return res.status(400).json({
        message: 'A data inicial não pode ser posterior à data final.',
      });
    }

    const ufNormalizada = String(uf || '').trim().toUpperCase();

    if (
      ufNormalizada &&
      !/^[A-Z]{2}$/.test(ufNormalizada)
    ) {
      return res.status(400).json({
        message: 'A UF informada é inválida.',
      });
    }

    const modalidadeNormalizada = normalizarModalidade(modalidade);
    const termos = extrairTermosDeBusca(termo);

    const paginaSolicitada = Math.max(
      1,
      Math.floor(Number(pagina) || 1)
    );

    const filtros = {
      dataInicial: inicio,
      dataFinal: fim,
      uf: ufNormalizada,
      modalidade: modalidadeNormalizada,
    };

    // Sem termos: usa diretamente a paginação nativa do PNCP.
    if (termos.length === 0) {
      const resposta = await requisitarPaginaPncp({
        ...filtros,
        pagina: paginaSolicitada,
      });

      const totalPaginas = obterTotalPaginas(resposta);

      return res.json({
        data: resposta.data,
        totalRegistros: Number(resposta.totalRegistros ?? 0),
        totalPaginas,
        numeroPagina: paginaSolicitada,
        paginasRestantes: Math.max(
          0,
          totalPaginas - paginaSolicitada
        ),
        empty: resposta.data.length === 0,
      });
    }

    const chave = chavePesquisa({
      ...filtros,
      termos,
    });

    limparCachesExpirados();

    let resultadoCache = cachePesquisas.get(chave);

    if (
      !resultadoCache ||
      Date.now() - resultadoCache.timestamp >= TEMPO_CACHE_MS
    ) {
      // Primeiro busca uma página para descobrir o total de páginas.
      const primeiraPagina = await requisitarPaginaPncp({
        ...filtros,
        pagina: 1,
      });

      const totalPaginasPncp = Math.min(
        obterTotalPaginas(primeiraPagina),
        1000
      );

      let registros = [...primeiraPagina.data];

      for (let numeroPagina = 2; numeroPagina <= totalPaginasPncp; numeroPagina++) {
        const resposta = await requisitarPaginaPncp({
          ...filtros,
          pagina: numeroPagina,
        });

        registros.push(...resposta.data);
      }

      registros = removerDuplicatas(registros);
      registros = filtrarPorTermos(registros, termos);

      resultadoCache = {
        timestamp: Date.now(),
        registros,
      };

      cachePesquisas.set(chave, resultadoCache);
    }

    const registros = resultadoCache.registros;
    const totalRegistros = registros.length;
    const totalPaginas = Math.max(
      1,
      Math.ceil(totalRegistros / TAMANHO_PAGINA)
    );

    const inicioPagina = (paginaSolicitada - 1) * TAMANHO_PAGINA;
    const dadosPagina = registros.slice(
      inicioPagina,
      inicioPagina + TAMANHO_PAGINA
    );

    return res.json({
      data: dadosPagina,
      totalRegistros,
      totalPaginas,
      numeroPagina: paginaSolicitada,
      paginasRestantes: Math.max(
        0,
        totalPaginas - paginaSolicitada
      ),
      empty: dadosPagina.length === 0,
    });
  } catch (erro) {
    console.error('Erro na consulta PNCP:', {
      message: erro.message,
      status: erro.status || erro.response?.status,
      resposta: erro.response?.data,
    });

    const status = erro.status || 502;

    return res.status(status).json({
      message: erro.message || 'Não foi possível consultar o PNCP.',
      code: status === 429 ? 'PNCP_RATE_LIMIT' : 'PNCP_ERROR',
    });
  }
}

module.exports = {
  searchPncpBids,
};
