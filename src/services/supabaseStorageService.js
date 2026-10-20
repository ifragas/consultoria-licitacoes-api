const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const uploadToSupabase = async (file) => {
  if (!file) return null;

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const ext = path.extname(file.originalname);
  const fileName = `documents-${uniqueSuffix}${ext}`;
  const filePath = `${fileName}`;

  // Envia o buffer do ficheiro para o bucket chamado 'documentos'
  const { data, error } = await supabase.storage
    .from('documentos') // Nome do bucket criado no Supabase
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    throw new Error(`Erro ao enviar ficheiro para o Supabase: ${error.message}`);
  }

  // Obter a URL pública do ficheiro
  const { data: publicUrlData } = supabase.storage
    .from('documentos')
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
};

module.exports = { uploadToSupabase };