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

    const params = {
      dataInicial: formatarData(trintaDiasAtras),
      dataFinal: formatarData(hoje),
      pagina: Number(pagina),
      tamanhoPagina: 10,
    };

    if (modalidade && modalidade !== '') {
      params.codigoModalidadeContratacao = Number(modalidade);
    } else {
      params.codigoModalidadeContratacao = 6;
    }

    // O PNCP utiliza o parâmetro 'q' ou 'descricaoContratacao' para busca textual por palavra-chave
    if (termo && termo.trim() !== '') {
      params.q = termo.trim();
    }

    if (uf) params.uf = uf.toUpperCase();

    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'accept': '*/*'
      }
    });

    let dataResult = response.data;

    // Filtro adicional no backend para garantir rigor nos resultados
    if (termo && termo.trim() !== '' && Array.isArray(dataResult.data)) {
      const palavraChave = termo.trim().toLowerCase();
      const resultadosFiltrados = dataResult.data.filter(item => 
        item.objetoCompra && item.objetoCompra.toLowerCase().includes(palavraChave)
      );
      
      // Se o filtro local encontrar itens correspondentes, atualiza o array de dados
      if (resultadosFiltrados.length > 0) {
        dataResult.data = resultadosFiltrados;
      }
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