// controllers/pncpController.js
const axios = require('axios');

// Função auxiliar para remover acentos e caracteres especiais para comparação
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

    // Se houver palavra-chave, buscamos mais registros (tamanhoPagina: 100) para filtrar localmente
    const possuiTermo = termo && termo.trim() !== '';
    const tamanhoPagina = possuiTermo ? 100 : 10;

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

    // Filtro tolerante a acentos e maiúsculas/minúsculas no Node.js
    if (possuiTermo && Array.isArray(dataResult.data)) {
      const termoNormalizado = removerAcentos(termo.trim());

      const itensFiltrados = dataResult.data.filter((item) => {
        const objetoNormalizado = removerAcentos(item.objetoCompra);
        const orgaoNormalizado = removerAcentos(item.orgaoEntidade?.razaoSocial);
        
        return objetoNormalizado.includes(termoNormalizado) || orgaoNormalizado.includes(termoNormalizado);
      });

      // Atualiza o resultado apenas com as correspondências reais
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