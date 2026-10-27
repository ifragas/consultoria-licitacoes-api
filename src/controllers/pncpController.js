// controllers/pncpController.js
const axios = require('axios');

// Remove acentos e converte para minúsculas
const normalizarTexto = (str) => {
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
      tamanhoPagina: 50,
    };

    if (uf) params.uf = uf.toUpperCase();

    // Fazemos a chamada estável sem o parâmetro 'q' direto na URL para evitar incompatibilidade da API pública
    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'accept': '*/*'
      }
    });

    let dataResult = response.data;

    // Se o usuário digitou uma palavra-chave, filtramos os resultados localmente no Node.js
    if (termo && termo.trim() !== '' && Array.isArray(dataResult.data)) {
      const termoBusca = normalizarTexto(termo.trim());

      const resultadosFiltrados = dataResult.data.filter((item) => {
        const objeto = normalizarTexto(item.objetoCompra);
        const orgao = normalizarTexto(item.orgaoEntidade?.razaoSocial);

        return objeto.includes(termoBusca) || orgao.includes(termoBusca);
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