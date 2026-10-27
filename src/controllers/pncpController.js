// controllers/pncpController.js
const axios = require('axios');

const normalizarTexto = (str) => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

// Função para extrair termos entre aspas e termos simples
const extrairTermosDeBusca = (termoGeral) => {
  const termos = [];
  // Expressão regular para pegar texto entre aspas ou palavras separadas por vírgula
  const regex = /"([^"]+)"|([^,]+)/g;
  let match;

  while ((match = regex.exec(termoGeral)) !== null) {
    const termoEncontrado = match[1] || match[2];
    if (termoEncontrado && termoEncontrado.trim()) {
      termos.push(termoEncontrado.trim());
    }
  }

  return termos;
};

const searchPncpBids = async (req, res) => {
  try {
    const { termo, uf, modalidade, pagina = 1 } = req.query;

    const baseUrl = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

    const hoje = new Date();
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(hoje.getDate() - 30);

    const formatarData = (date) => date.toISOString().split('T')[0].replace(/-/g, '');

    const params = {
      dataInicial: formatarData(trintaDiasAtras),
      dataFinal: formatarData(hoje),
      codigoModalidadeContratacao: modalidade ? Number(modalidade) : 6,
      pagina: Number(pagina),
      tamanhoPagina: 50,
    };

    if (uf) params.uf = uf.toUpperCase();

    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'accept': '*/*'
      }
    });

    let dataResult = response.data;

    if (termo && termo.trim() !== '' && Array.isArray(dataResult.data)) {
      const listaTermos = extrairTermosDeBusca(termo);

      const resultadosFiltrados = dataResult.data.filter((item) => {
        const textoObjeto = normalizarTexto(item.objetoCompra);
        const textoOrgao = normalizarTexto(item.orgaoEntidade?.razaoSocial);
        const textoCompleto = `${textoObjeto} ${textoOrgao}`;

        // Verifica se pelo menos UM dos termos/expressões existe no texto
        return listaTermos.some((termoItem) => {
          // Trata coringas como % (ex: transporte%alunos -> engloba transporte de alunos)
          const partesComCoringa = termoItem.split('%').map(p => normalizarTexto(p.trim())).filter(Boolean);

          if (partesComCoringa.length > 1) {
            return partesComCoringa.every(p => textoCompleto.includes(p));
          }

          const termoLimpo = normalizarTexto(termoItem);
          return textoCompleto.includes(termoLimpo);
        });
      });

      dataResult.data = resultadosFiltrados;
      dataResult.totalRegistros = resultadosFiltrados.length;
      dataResult.totalPaginas = Math.ceil(resultadosFiltrados.length / 10) || 1;
    }

    res.status(200).json(dataResult);
  } catch (error) {
    console.error('Erro detalhado no PNCP:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      message: 'Erro ao consultar API do PNCP',
      error: error.response?.data || error.message
    });
  }
};

module.exports = { searchPncpBids };