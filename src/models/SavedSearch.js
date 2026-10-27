// models/SavedSearch.js
const mongoose = require('mongoose');

const SavedSearchSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  termo: {
    type: String,
    required: true
  },
  uf: {
    type: String,
    default: ''
  },
  modalidade: {
    type: String,
    default: '6'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SavedSearch', SavedSearchSchema);