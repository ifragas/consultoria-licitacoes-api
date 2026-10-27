// controllers/pncpController.js
const axios = require('axios');

const searchPncpBids = async (req, res) => {
  try {
    const { termo, uf, modalidade, pagina = 1 } = req.query;

    const baseUrl = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

    const hoje = new Date();
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(hoje.getDate() - 30);

    const formatarData = (date) => date.toISOString().split('T')[0].replace(/-/g, '');

    // Se houver palavra-chave, aumentamos a busca inicial para 50 itens para podermos filtrar com precisão
    const tamanhoPagina = (termo && termo.trim() !== '') ? 50 : 10;

    const params = {
      dataInicial: formatarData(trintaDiasAtras),
      dataFinal: formatarData(hoje),
      codigoModalidadeContratacao: modalidade ? Number(modalidade) : 6,
      pagina: Number(pagina),
      tamanhoPagina: tamanhoPagina,
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

    // Filtro estrito por palavra-chave no Node.js
    if (termo && termo.trim() !== '' && Array.isArray(dataResult.data)) {
      const termoBusca = termo.trim().toLowerCase();

      const itensFiltrados = dataResult.data.filter((item) => {
        const objeto = (item.objetoCompra || '').toLowerCase();
        const orgao = (item.orgaoEntidade?.razaoSocial || '').toLowerCase();
        
        return objeto.includes(termoBusca) || orgao.includes(termoBusca);
      });

      // Sobrescreve os dados e ajusta as métricas para a tela do React
      dataResult.data = itensFiltrados;
      dataResult.totalRegistros = itensFiltrados.length;
      dataResult.totalPaginas = Math.ceil(itensFiltrados.length / 10) || 1;
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