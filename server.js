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
// CRIAR TABELAS
// ==========================

async function criarTabela() {
    try {

        // ==========================
        // FOTOS
        // ==========================

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


        // ==========================
        // MÚSICAS
        // ==========================

        await pool.query(`
            CREATE TABLE IF NOT EXISTS musicas (
                id BIGSERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                artista TEXT NOT NULL,
                mensagem TEXT,
                youtube_url TEXT,
                spotify_url TEXT,
                data_dia TIMESTAMPTZ,
                musica_do_dia BOOLEAN DEFAULT FALSE,
                ordem_dia INTEGER,
                adicionada_por TEXT,
                escolhida_por TEXT,
                criada_em TIMESTAMPTZ DEFAULT NOW()
            );
        `);


        // ==========================
        // GARANTIR COLUNAS
        // CASO A TABELA JÁ EXISTISSE
        // ==========================

        await pool.query(`
            ALTER TABLE musicas
            ADD COLUMN IF NOT EXISTS ordem_dia INTEGER;
        `);

        await pool.query(`
            ALTER TABLE musicas
            ADD COLUMN IF NOT EXISTS musica_do_dia BOOLEAN DEFAULT FALSE;
        `);

        await pool.query(`
            ALTER TABLE musicas
            ADD COLUMN IF NOT EXISTS data_dia TIMESTAMPTZ;
        `);

        await pool.query(`
            ALTER TABLE musicas
            ADD COLUMN IF NOT EXISTS adicionada_por TEXT;
        `);

        await pool.query(`
            ALTER TABLE musicas
            ADD COLUMN IF NOT EXISTS escolhida_por TEXT;
        `);


        console.log("Tabelas verificadas.");

    } catch (erro) {
        console.error("Erro ao criar tabelas:", erro);
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


// ==================================================
// FOTOS
// ==================================================


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


// ==================================================
// MÚSICAS
// ==================================================


// ==========================
// LISTAR MÚSICAS
// ==========================

app.get("/api/musicas", async (req, res) => {

    try {

        // ==========================
        // EXPIRAR MÚSICAS DO DIA
        // APÓS 24 HORAS
        // ==========================

        await pool.query(`
            UPDATE musicas

            SET musica_do_dia = FALSE,
                data_dia = NULL,
                escolhida_por = NULL

            WHERE musica_do_dia = TRUE

            AND data_dia IS NOT NULL

            AND data_dia <= NOW() - INTERVAL '24 hours'
        `);


        // ==========================
        // BUSCAR MÚSICAS
        // ==========================

        const resultado = await pool.query(`
            SELECT *
            FROM musicas
            ORDER BY criada_em DESC
        `);


        res.json(resultado.rows);


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao buscar músicas."
        });

    }

});


// ==========================
// ADICIONAR MÚSICA
// ==========================

app.post("/api/musicas", async (req, res) => {

    try {

        const {
            titulo,
            artista,
            mensagem,
            youtube_url,
            spotify_url,
            adicionada_por
        } = req.body;


        // ==========================
        // VALIDAÇÃO
        // ==========================

        if (!titulo || !artista) {

            return res.status(400).json({
                erro: "Título e artista são obrigatórios."
            });

        }


        // ==========================
        // SALVAR MÚSICA
        // ==========================

        const resultado = await pool.query(
            `
            INSERT INTO musicas
            (
                titulo,
                artista,
                mensagem,
                youtube_url,
                spotify_url,
                adicionada_por
            )

            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
            )

            RETURNING *
            `,

            [
                titulo,
                artista,
                mensagem || null,
                youtube_url || null,
                spotify_url || null,
                adicionada_por || null
            ]
        );


        res.status(201).json({

            mensagem: "Música adicionada com sucesso!",

            musica: resultado.rows[0]

        });


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao salvar música."
        });

    }

});


// ==========================
// DEFINIR MÚSICA DO DIA
// ==========================
//
// pessoa:
// "voce"
// "ela"
// ==========================

app.put("/api/musicas/:id/dia", async (req, res) => {

    const { id } = req.params;
    const { pessoa } = req.body;


    // ==========================
    // VALIDAR PESSOA
    // ==========================

    if (!["voce", "ela"].includes(pessoa)) {

        return res.status(400).json({
            erro: "Pessoa inválida."
        });

    }


    try {

        // ==========================
        // REMOVER MÚSICA DO DIA
        // DAQUELA PESSOA
        // ==========================

        await pool.query(
            `
            UPDATE musicas

            SET musica_do_dia = FALSE,
                data_dia = NULL,
                escolhida_por = NULL

            WHERE musica_do_dia = TRUE

            AND escolhida_por = $1
            `,

            [pessoa]
        );


        // ==========================
        // DEFINIR NOVA MÚSICA
        // ==========================

        const resultado = await pool.query(
            `
            UPDATE musicas

            SET musica_do_dia = TRUE,
                escolhida_por = $1,
                data_dia = NOW()

            WHERE id = $2

            RETURNING *
            `,

            [pessoa, id]
        );


        // ==========================
        // MÚSICA NÃO EXISTE
        // ==========================

        if (resultado.rows.length === 0) {

            return res.status(404).json({
                erro: "Música não encontrada."
            });

        }


        res.json(resultado.rows[0]);


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao definir música do dia."
        });

    }

});


// ==========================
// EDITAR MÚSICA
// ==========================

app.put("/api/musicas/:id", async (req, res) => {

    const { id } = req.params;

    const {
        titulo,
        artista,
        mensagem,
        youtube_url,
        spotify_url
    } = req.body;


    try {

        const resultado = await pool.query(
            `
            UPDATE musicas

            SET titulo = $1,
                artista = $2,
                mensagem = $3,
                youtube_url = $4,
                spotify_url = $5

            WHERE id = $6

            RETURNING *
            `,

            [
                titulo,
                artista,
                mensagem || null,
                youtube_url || null,
                spotify_url || null,
                id
            ]
        );


        if (resultado.rows.length === 0) {

            return res.status(404).json({
                erro: "Música não encontrada."
            });

        }


        res.json(resultado.rows[0]);


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao editar música."
        });

    }

});


// ==========================
// EXCLUIR MÚSICA
// ==========================

app.delete("/api/musicas/:id", async (req, res) => {

    try {

        const { id } = req.params;


        const resultado = await pool.query(
            `
            DELETE FROM musicas

            WHERE id = $1

            RETURNING *
            `,

            [id]
        );


        if (resultado.rows.length === 0) {

            return res.status(404).json({
                erro: "Música não encontrada."
            });

        }


        res.json({
            mensagem: "Música excluída com sucesso!"
        });


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao excluir música."
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