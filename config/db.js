import pg from "pg"
import env from "dotenv"

env.config()

const { Pool } = pg;

/*const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT
})*/

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
})

pool.connect()

export default pool