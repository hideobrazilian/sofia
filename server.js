import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import pg from "pg";
import path from "path";
import fs from "fs";

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// MIDDLEWARE
// ==========================

app.use(cors());
app.use(express.json());

// ==========================
// PASTA DE UPLOADS
// ==========================

const pastaUploads = path.join(process.cwd(), "uploads");

if (!fs.existsSync(pastaUploads)) {
  fs.mkdirSync(pastaUploads, { recursive: true });
}

// Permite acessar as imagens
app.use("/uploads", express.static(pastaUploads));

// ==========================
// POSTGRESQL
// ==========================
console.log("DATABASE_URL:", process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
pool.query("SELECT NOW()")
  .then(resultado => {
    console.log("Banco conectado:", resultado.rows[0]);
  })
  .catch(erro => {
    console.error("Erro ao conectar no banco:", erro);
  });

// ==========================
// CRIAR TABELA
// ==========================

async function criarTabela() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fotos (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    url TEXT NOT NULL,
    legenda TEXT,
    data_momento DATE,
    mensagem TEXT,
    data TIMESTAMPTZ DEFAULT NOW()
);
    `);
    await pool.query(`
    ALTER TABLE fotos
    ADD COLUMN IF NOT EXISTS data_momento DATE;
`);

await pool.query(`
    ALTER TABLE fotos
    ADD COLUMN IF NOT EXISTS mensagem TEXT;
`);

    console.log("Tabela fotos verificada.");

  } catch (erro) {
    console.error("Erro ao criar tabela:", erro);
  }
}

criarTabela();

// ==========================
// MULTER
// ==========================

const storage = multer.diskStorage({

  destination: function (req, file, cb) {
    cb(null, pastaUploads);
  },

  filename: function (req, file, cb) {

    const extensao = path.extname(file.originalname);

    const nome =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      extensao;

    cb(null, nome);
  },
});

const upload = multer({

  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter: function (req, file, cb) {

    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("O arquivo precisa ser uma imagem."));
    }
  },
});

// ==========================
// TESTE
// ==========================

app.get("/", (req, res) => {

  res.json({
    mensagem: "API do projeto NÓS funcionando!",
  });

});

// ==========================
// LISTAR FOTOS
// ==========================

app.get("/api/fotos", async (req, res) => {

  try {

    const resultado = await pool.query(`
      SELECT *
      FROM fotos
      ORDER BY data DESC
    `);

    res.json(resultado.rows);

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar fotos.",
    });

  }

});

// ==========================
// ENVIAR FOTO
// ==========================

app.post(
  "/api/fotos",
  upload.single("imagem"),
  async (req, res) => {

    try {

      if (!req.file) {

        return res.status(400).json({
          erro: "Nenhuma imagem enviada.",
        });

      }

      const dataMomento =
    req.body.data_momento || null;

const mensagem =
    req.body.mensagem || null;

      // URL pública da imagem
      const url =
        `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

      // Salvar no PostgreSQL
      const resultado = await pool.query(
        `
       INSERT INTO fotos
    (nome, url, data_momento, mensagem)
VALUES
    ($1, $2, $3, $4)
RETURNING *
        `,
        [
    req.file.originalname,
    url,
    dataMomento,
    mensagem
]
      );

      res.status(201).json({
        mensagem: "Imagem criada com sucesso!",
        foto: resultado.rows[0],
      });

    } catch (erro) {

      console.error(erro);

      // Se deu erro no banco, remove a imagem
      if (req.file) {

        const caminho =
          path.join(pastaUploads, req.file.filename);

        if (fs.existsSync(caminho)) {
          fs.unlinkSync(caminho);
        }
      }

      res.status(500).json({
        erro: "Erro ao salvar imagem.",
      });

    }

  }
);

// ==========================
// EXCLUIR FOTO
// ==========================

app.delete("/api/fotos/:id", async (req, res) => {

  try {

    const { id } = req.params;

    // Buscar foto
    const resultado = await pool.query(
      "SELECT * FROM fotos WHERE id = $1",
      [id]
    );

    if (resultado.rows.length === 0) {

      return res.status(404).json({
        erro: "Foto não encontrada.",
      });

    }

    const foto = resultado.rows[0];

    // Pegar nome do arquivo pela URL
    const nomeArquivo =
      path.basename(new URL(foto.url).pathname);

    const caminho =
      path.join(pastaUploads, nomeArquivo);

    // Apagar arquivo
    if (fs.existsSync(caminho)) {
      fs.unlinkSync(caminho);
    }

    // Apagar banco
    await pool.query(
      "DELETE FROM fotos WHERE id = $1",
      [id]
    );

    res.json({
      mensagem: "Foto excluída com sucesso!",
    });

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao excluir foto.",
    });

  }

});

// ==========================
// TRATAMENTO DE ERROS
// ==========================

app.use((erro, req, res, next) => {

  console.error(erro);

  if (erro instanceof multer.MulterError) {

    if (erro.code === "LIMIT_FILE_SIZE") {

      return res.status(400).json({
        erro: "A imagem pode ter no máximo 10 MB.",
      });

    }

  }

  res.status(400).json({
    erro: erro.message || "Erro no servidor.",
  });

});

// ==========================
// SERVIDOR
// ==========================

app.listen(PORT, () => {

  console.log(
    `Servidor rodando na porta ${PORT}`
  );

});