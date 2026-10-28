
const mongoose = require('mongoose');

const pncpBidSchema = new mongoose.Schema(
  {
    // Identificador único da contratação no PNCP.
    numeroControlePNCP: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    objetoCompra: {
      type: String,
      default: '',
      trim: true,
    },

    informacaoComplementar: {
      type: String,
      default: '',
    },

    modalidadeId: {
      type: Number,
      default: null,
      index: true,
    },

    modalidadeNome: {
      type: String,
      default: '',
    },

    orgaoCnpj: {
      type: String,
      default: '',
      index: true,
    },

    orgaoNome: {
      type: String,
      default: '',
    },

    unidadeNome: {
      type: String,
      default: '',
    },

    uf: {
      type: String,
      default: '',
      uppercase: true,
      index: true,
    },

    municipio: {
      type: String,
      default: '',
    },

    anoCompra: {
      type: Number,
      default: null,
      index: true,
    },

    sequencialCompra: {
      type: String,
      default: '',
    },

    valorTotalEstimado: {
      type: Number,
      default: null,
    },

    dataPublicacaoPncp: {
      type: Date,
      default: null,
    },

    dataAberturaProposta: {
      type: Date,
      default: null,
    },

    dataEncerramentoProposta: {
      type: Date,
      default: null,
      index: true,
    },

    situacaoCompra: {
      type: String,
      default: '',
      index: true,
    },

    urlPncp: {
      type: String,
      default: '',
    },

    // Mantém o objeto original recebido do PNCP para permitir
    // mapear campos adicionais sem perder informações.
    dadosOriginais: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    sincronizadoEm: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'pncp_bids',
  }
);

// Índices compostos para os filtros mais comuns do Garimpo.
pncpBidSchema.index({
  uf: 1,
  dataEncerramentoProposta: 1,
});

pncpBidSchema.index({
  modalidadeId: 1,
  dataEncerramentoProposta: 1,
});

pncpBidSchema.index({
  situacaoCompra: 1,
  dataEncerramentoProposta: 1,
});

module.exports = mongoose.model('PncpBid', pncpBidSchema);
