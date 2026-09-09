import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import pg from "pg";
import { v2 as cloudinary } from "cloudinary";

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;


// ==========================
// MIDDLEWARE
// ==========================

app.use(cors());
app.use(express.json());


// ==========================
// CLOUDINARY
// ==========================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


// ==========================
// POSTGRESQL
// ==========================

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
                data TIMESTAMPTZ DEFAULT NOW(),
                public_id TEXT
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

        await pool.query(`
            ALTER TABLE fotos
            ADD COLUMN IF NOT EXISTS public_id TEXT;
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

// A imagem fica somente na memória
// enquanto é enviada para o Cloudinary.

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("O arquivo precisa ser uma imagem."));
        }

    }

});


// ==========================
// UPLOAD CLOUDINARY
// ==========================

function uploadParaCloudinary(buffer) {

    return new Promise((resolve, reject) => {

        const stream = cloudinary.uploader.upload_stream(

            {
                folder: "nos/fotos",
                resource_type: "image"
            },

            (erro, resultado) => {

                if (erro) {
                    reject(erro);
                } else {
                    resolve(resultado);
                }

            }

        );

        stream.end(buffer);

    });

}


// ==========================
// TESTE
// ==========================

app.get("/", (req, res) => {

    res.json({
        mensagem: "API do projeto NÓS funcionando!"
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
            erro: "Erro ao buscar fotos."
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
                    erro: "Nenhuma imagem enviada."
                });

            }


            const dataMomento =
                req.body.data_momento || null;

            const mensagem =
                req.body.mensagem || null;


            // ==========================
            // CLOUDINARY
            // ==========================

            const imagem = await uploadParaCloudinary(
                req.file.buffer
            );


            console.log(
                "Imagem enviada para Cloudinary:",
                imagem.secure_url
            );


            // ==========================
            // POSTGRESQL
            // ==========================

            const resultado = await pool.query(

                `
                INSERT INTO fotos
                (
                    nome,
                    url,
                    data_momento,
                    mensagem,
                    public_id
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5
                )
                RETURNING *
                `,

                [
                    req.file.originalname,
                    imagem.secure_url,
                    dataMomento,
                    mensagem,
                    imagem.public_id
                ]

            );


            res.status(201).json({

                mensagem: "Imagem criada com sucesso!",

                foto: resultado.rows[0]

            });

        } catch (erro) {

            console.error(
                "Erro ao salvar imagem:",
                erro
            );

            res.status(500).json({

                erro: "Erro ao salvar imagem."

            });

        }

    }
);


// ==========================
// EXCLUIR FOTO
// ==========================

app.delete(
    "/api/fotos/:id",

    async (req, res) => {

        try {

            const { id } = req.params;


            // ==========================
            // BUSCAR FOTO
            // ==========================

            const resultado = await pool.query(
                "SELECT * FROM fotos WHERE id = $1",
                [id]
            );


            if (resultado.rows.length === 0) {

                return res.status(404).json({
                    erro: "Foto não encontrada."
                });

            }


            const foto = resultado.rows[0];


            // ==========================
            // CLOUDINARY
            // ==========================

            if (foto.public_id) {

                try {

                    await cloudinary.uploader.destroy(
                        foto.public_id,
                        {
                            resource_type: "image"
                        }
                    );

                    console.log(
                        "Imagem removida do Cloudinary:",
                        foto.public_id
                    );

                } catch (erro) {

                    console.error(
                        "Erro ao remover imagem do Cloudinary:",
                        erro
                    );

                }

            }


            // ==========================
            // POSTGRESQL
            // ==========================

            await pool.query(
                "DELETE FROM fotos WHERE id = $1",
                [id]
            );


            res.json({
                mensagem: "Foto excluída com sucesso!"
            });


        } catch (erro) {

            console.error(erro);

            res.status(500).json({
                erro: "Erro ao excluir foto."
            });

        }

    }
);


// ==========================
// TRATAMENTO DE ERROS
// ==========================

app.use((erro, req, res, next) => {

    console.error(erro);


    if (erro instanceof multer.MulterError) {

        if (erro.code === "LIMIT_FILE_SIZE") {

            return res.status(400).json({
                erro: "A imagem pode ter no máximo 10 MB."
            });

        }

    }


    res.status(400).json({
        erro: erro.message || "Erro no servidor."
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