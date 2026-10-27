// controllers/pncpController.js
const axios = require('axios');

const searchPncpBids = async (req, res) => {
  try {
    const { termo, uf, modalidade = 6, pagina = 1 } = req.query; // Padrão 6 (Pregão Eletrônico)

    const baseUrl = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

    const hoje = new Date();
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(hoje.getDate() - 30);

    const formatarData = (date) => date.toISOString().split('T')[0].replace(/-/g, '');

    const params = {
      dataInicial: formatarData(trintaDiasAtras),
      dataFinal: formatarData(hoje),
      codigoModalidadeContratacao: Number(modalidade), // Obrigatório pela API do PNCP
      pagina: Number(pagina),
      tamanhoPagina: 10,
    };

    if (termo) params.objeto = termo;
    if (uf) params.uf = uf.toUpperCase();

    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'accept': '*/*'
      }
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Erro detalhado no PNCP:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      message: 'Erro ao consultar API do PNCP',
      error: error.response?.data || error.message
    });
  }
};

module.exports = { searchPncpBids };