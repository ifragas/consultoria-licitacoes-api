// controllers/pncpController.js
const axios = require('axios');

// Função para remover acentos e padronizar textos para comparação
const removerAcentos = (str) => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

const searchPncpBids = async (req, res) => {
  try {
    const { termo, uf, modalidade, pagina = 1 } = req.query;

    const baseUrl = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

    // Intervalo de busca (últimos 30 dias)
    const hoje = new Date();
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(hoje.getDate() - 30);

    const formatarData = (date) => date.toISOString().split('T')[0].replace(/-/g, '');

    const params = {
      dataInicial: formatarData(trintaDiasAtras),
      dataFinal: formatarData(hoje),
      codigoModalidadeContratacao: modalidade ? Number(modalidade) : 6,
      pagina: Number(pagina),
      tamanhoPagina: 50, // Mantido em 50 para garantir estabilidade e evitar erros na API do governo
    };

    // Envia a palavra-chave no parâmetro 'q' aceito pela API pública
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

    // Refinamento de garantia no Node.js (insensível a acentos)
    if (termo && termo.trim() !== '' && Array.isArray(dataResult.data)) {
      const termoNormalizado = removerAcentos(termo.trim());

      const resultadosFiltrados = dataResult.data.filter((item) => {
        const objetoNormalizado = removerAcentos(item.objetoCompra);
        const orgaoNormalizado = removerAcentos(item.orgaoEntidade?.razaoSocial);

        return objetoNormalizado.includes(termoNormalizado) || orgaoNormalizado.includes(termoNormalizado);
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