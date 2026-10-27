
const axios = require('axios');

const PNCP_URL =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const TAMANHO_PAGINA = 50;
const TAMANHO_LOTE = 5;
const TIMEOUT_REQUISICAO = 45000;

// Normaliza textos para permitir buscas sem diferenciar
// maiúsculas, minúsculas ou acentos.
const normalizarTexto = (texto) => {
  if (!texto) return '';

  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

// Usa a data local, evitando diferenças de dia causadas pelo UTC.
const formatarData = (data) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');

  return `${ano}${mes}${dia}`;
};

// Separa os termos por vírgulas, preservando frases entre aspas.
// Exemplo: areia, brita, "pavimentação asfáltica".
const extrairTermosDeBusca = (termoGeral) => {
  if (!termoGeral || !String(termoGeral).trim()) {
    return [];
  }

  const termos = [];
  const regex = /"([^"]+)"|([^,]+)/g;
  let match;

  while ((match = regex.exec(String(termoGeral))) !== null) {
    const termo = (match[1] || match[2] || '').trim();

    if (termo) {
      termos.push(termo);
    }
  }

  return termos;
};

// Pesquisa modalidade específica ou todas as modalidades.
// Valores como "", "todas", "todos", "all" e "0"
// são tratados como ausência de filtro.
const normalizarModalidade = (modalidade) => {
  if (
    modalidade === undefined ||
    modalidade === null ||
    String(modalidade).trim() === ''
  ) {
    return null;
  }

  const valor = String(modalidade).trim();
  const valorNormalizado = normalizarTexto(valor);

  if (
    ['todas', 'todos', 'all', 'qualquer', '0'].includes(
      valorNormalizado
    )
  ) {
    return null;
  }

  const codigo = Number(valor);

  if (!Number.isInteger(codigo) || codigo < 1) {
    throw new Error(
      `Código de modalidade inválido: ${valor}`
    );
  }

  return codigo;
};

// Trata o curinga % como separador de partes obrigatórias.
// Exemplo: transporte%alunos exige que ambos apareçam no texto.
const correspondeTermo = (textoCompleto, termoOriginal) => {
  const partes = String(termoOriginal)
    .split('%')
    .map(normalizarTexto)
    .filter(Boolean);

  if (partes.length > 1) {
    return partes.every((parte) =>
      textoCompleto.includes(parte)
    );
  }

  const termo = normalizarTexto(termoOriginal);

  return termo !== '' && textoCompleto.includes(termo);
};

// Basta um dos termos cadastrados corresponder ao objeto
// da contratação ou ao nome do órgão.
const filtrarPorTermos = (licitacoes, termos) => {
  if (!termos.length) {
    return licitacoes;
  }

  return licitacoes.filter((item) => {
    const objeto = normalizarTexto(item.objetoCompra);
    const orgao = normalizarTexto(
      item.orgaoEntidade?.razaoSocial
    );

    const textoCompleto = `${objeto} ${orgao}`;

    return termos.some((termo) =>
      correspondeTermo(textoCompleto, termo)
    );
  });
};

// Executa uma requisição ao PNCP.
const buscarPaginaPncp = async (params) => {
  const response = await axios.get(PNCP_URL, {
    params,
    timeout: TIMEOUT_REQUISICAO,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: '*/*',
    },
  });

  return response.data;
};

// Consulta todas as páginas do PNCP em lotes.
// Usado quando existe uma lista de termos para pesquisar.
const buscarTodasAsPaginas = async (
  paramsBase,
  primeiraResposta
) => {
  const totalPaginas = Math.max(
    1,
    Number(primeiraResposta.totalPaginas) || 1
  );

  const todosOsRegistros = Array.isArray(
    primeiraResposta.data
  )
    ? [...primeiraResposta.data]
    : [];

  for (
    let inicio = 2;
    inicio <= totalPaginas;
    inicio += TAMANHO_LOTE
  ) {
    const fim = Math.min(
      inicio + TAMANHO_LOTE - 1,
      totalPaginas
    );

    const paginas = [];

    for (let pagina = inicio; pagina <= fim; pagina++) {
      paginas.push(pagina);
    }

    const respostas = await Promise.all(
      paginas.map((pagina) =>
        buscarPaginaPncp({
          ...paramsBase,
          pagina,
        })
      )
    );

    for (const resposta of respostas) {
      if (Array.isArray(resposta.data)) {
        todosOsRegistros.push(...resposta.data);
      }
    }
  }

  return todosOsRegistros;
};

// Remove duplicatas utilizando o identificador oficial,
// preservando registros que não tenham esse identificador.
const removerDuplicatas = (registros) => {
  const identificadores = new Set();

  return registros.filter((item) => {
    const identificador = item.numeroControlePNCP;

    if (!identificador) {
      return true;
    }

    if (identificadores.has(identificador)) {
      return false;
    }

    identificadores.add(identificador);

    return true;
  });
};

const searchPncpBids = async (req, res) => {
  try {
    const {
      termo = '',
      uf,
      modalidade,
      pagina = 1,
      dataInicial,
      dataFinal,
    } = req.query;

    const paginaSolicitada = Math.max(
      1,
      Number.parseInt(pagina, 10) || 1
    );

    // Datas padrão: hoje até 30 dias à frente.
    const hoje = new Date();
    const dataFutura = new Date(hoje);

    dataFutura.setDate(dataFutura.getDate() + 30);

    const dtInicioFormatada = dataInicial
      ? String(dataInicial).replace(/-/g, '')
      : formatarData(hoje);

    const dtFimFormatada = dataFinal
      ? String(dataFinal).replace(/-/g, '')
      : formatarData(dataFutura);

    // Validação das datas recebidas.
    if (
      !/^\d{8}$/.test(dtInicioFormatada) ||
      !/^\d{8}$/.test(dtFimFormatada)
    ) {
      return res.status(400).json({
        message:
          'Datas inválidas. Utilize o formato AAAA-MM-DD.',
      });
    }

    if (dtInicioFormatada > dtFimFormatada) {
      return res.status(400).json({
        message:
          'A data inicial não pode ser posterior à data final.',
      });
    }

    // Monta os parâmetros básicos da consulta.
    const paramsBase = {
      dataInicial: dtInicioFormatada,
      dataFinal: dtFimFormatada,
      pagina: 1,
      tamanhoPagina: TAMANHO_PAGINA,
    };

    // Aplica modalidade somente se houver uma seleção específica.
    const codigoModalidade = normalizarModalidade(modalidade);

    if (codigoModalidade !== null) {
      paramsBase.codigoModalidadeContratacao =
        codigoModalidade;
    }

    if (uf && String(uf).trim()) {
      paramsBase.uf = String(uf).trim().toUpperCase();
    }

    const termos = extrairTermosDeBusca(termo);

    console.log('=== CONSULTA PNCP ===');
    console.log(
      'Período:',
      dtInicioFormatada,
      'até',
      dtFimFormatada
    );
    console.log('UF:', paramsBase.uf || 'Todas');
    console.log(
      'Modalidade:',
      codigoModalidade === null
        ? 'Todas'
        : codigoModalidade
    );
    console.log('Quantidade de termos:', termos.length);
    console.log('Página solicitada:', paginaSolicitada);

    // Primeira consulta para obter os metadados do PNCP.
    const primeiraResposta = await buscarPaginaPncp(
      paramsBase
    );

    let resultados = [];
    let totalRegistros = 0;
    let totalPaginas = 1;
    let numeroPagina = paginaSolicitada;

    if (termos.length > 0) {
      // Com termos, percorre todas as páginas disponíveis
      // antes de aplicar a pesquisa local.
      const todosOsRegistros = await buscarTodasAsPaginas(
        paramsBase,
        primeiraResposta
      );

      const resultadosFiltrados = filtrarPorTermos(
        todosOsRegistros,
        termos
      );

      const listaFinal = removerDuplicatas(
        resultadosFiltrados
      );

      totalRegistros = listaFinal.length;

      totalPaginas = Math.max(
        1,
        Math.ceil(totalRegistros / TAMANHO_PAGINA)
      );

      numeroPagina = Math.min(
        paginaSolicitada,
        totalPaginas
      );

      const inicio =
        (numeroPagina - 1) * TAMANHO_PAGINA;

      resultados = listaFinal.slice(
        inicio,
        inicio + TAMANHO_PAGINA
      );

      console.log(
        'Registros consultados no PNCP:',
        todosOsRegistros.length
      );
      console.log(
        'Registros encontrados pelos termos:',
        totalRegistros
      );
      console.log(
        'Páginas de resultados:',
        totalPaginas
      );
    } else {
      // Sem termos, utiliza a paginação original do PNCP.
      const resposta =
        paginaSolicitada === 1
          ? primeiraResposta
          : await buscarPaginaPncp({
              ...paramsBase,
              pagina: paginaSolicitada,
            });

      resultados = Array.isArray(resposta.data)
        ? resposta.data
        : [];

      totalRegistros = Number(
        resposta.totalRegistros || 0
      );

      totalPaginas = Math.max(
        1,
        Number(resposta.totalPaginas) || 1
      );

      numeroPagina = Number(
        resposta.numeroPagina || paginaSolicitada
      );
    }

    return res.status(200).json({
      ...primeiraResposta,
      data: resultados,
      totalRegistros,
      totalPaginas,
      numeroPagina,
      paginasRestantes: Math.max(
        0,
        totalPaginas - numeroPagina
      ),
      empty: resultados.length === 0,
    });
  } catch (error) {
    console.error(
      'Erro detalhado no PNCP:',
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      message: 'Erro ao consultar API do PNCP',
      error:
        error.response?.data || error.message,
    });
  }
};

module.exports = { searchPncpBids };
