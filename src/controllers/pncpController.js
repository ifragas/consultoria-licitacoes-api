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
    const { termo, uf, modalidade, pagina = 1, dataInicial, dataFinal } = req.query;

    // Alterado para o endpoint geral de contratações públicas para abranger o intervalo de datas completo
    const baseUrl = 'https://pncp.gov.br/api/consulta/v1/contratacoes';

    const formatarData = (date) => date.toISOString().split('T')[0].replace(/-/g, '');

    // Se o front não mandar datas, usa HOJE até HOJE + 30 DIAS (Futuro) por padrão
    const hoje = new Date();
    const trintaDiasFrente = new Date();
    trintaDiasFrente.setDate(hoje.getDate() + 30);

    // Trata e formata as datas recebidas em YYYY-MM-DD
    const dtInicioFormatada = dataInicial ? dataInicial.replace(/-/g, '') : formatarData(hoje);
    const dtFimFormatada = dataFinal ? dataFinal.replace(/-/g, '') : formatarData(trintaDiasFrente);

    const params = {
      dataInicial: dtInicioFormatada,
      dataFinal: dtFimFormatada,
      codigoModalidadeContratacao: modalidade ? Number(modalidade) : 6,
      pagina: Number(pagina),
      tamanhoPagina: 50, // Limite máximo aceito pelo PNCP
    };

    if (uf) params.uf = uf.toUpperCase();

    console.log('Parâmetros exatos enviados ao PNCP:', params);

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

        return listaTermos.some((termoItem) => {
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