import express from "express"
import bodyParser from "body-parser"
import pg from "pg"
import bcrypt from "bcrypt"
import session from "express-session"
import passport from "passport"
import { Strategy } from "passport-local"
import GoogleStrategy from "passport-google-oauth2"
import flash from "connect-flash"
import env from "dotenv"
import axios from "axios"

const app = express()
const port = 3000
const saltRounds = 10
env.config()

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT
})
db.connect()

app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static("public"))

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24,
        },
    })
)

app.use(passport.initialize())
app.use(passport.session())
app.use(flash())

app.use((req, res, next) => {
    res.locals.error = req.flash("error")
    res.locals.success = req.flash("success")
    next()
})

app.get("/", (req, res) => {
    res.render("login.ejs")
})

app.get("/login", (req, res) => {
    res.render("login.ejs")
})

app.get("/register", (req, res) => {
    res.render("register.ejs")
})

app.post("/newBook", async (req, res) => {
    const title = req.body.title;
    const notes = req.body.notes;
    const rating = req.body.rating;

    if (req.isAuthenticated()) {
        try {
            const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${title}`);
            if (searchBook.data.docs.length > 0) {
                await db.query(
                    "INSERT INTO books (title, description, user_id) VALUES ($1, $2, $3)", 
                    [title, notes, req.user.id]
                );
                req.flash("success", "Book added successfully!");
                res.redirect('/home');
            } else {
                req.flash("error", "Unable to add Book!");
                res.redirect('/home');
            }
        } catch (err) {
            console.log(err);
        } 
    } else {
        res.redirect("/login");
    }
});

app.get("/home", async (req, res) => {
    if (req.isAuthenticated()) {
        const page = parseInt(req.query.page) || 1;
        const limit = 6; // Número de livros por página
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(
                "SELECT * FROM books WHERE user_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3",
                [req.user.id, limit, offset]
            );

            const countResult = await db.query(
                "SELECT COUNT(*) FROM books WHERE user_id = $1",
                [req.user.id]
            );

            const totalBooks = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(totalBooks / limit);

            const listBooks = await Promise.all(result.rows.map(async (book) => {
                try {
                    const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${book.title}`);
                    const isbn = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].isbn) ? searchBook.data.docs[0].isbn[0] : 'ISBN Not Found';
                    const author = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].author_name) ? searchBook.data.docs[0].author_name[0] : 'Author Not Found';
                    return {
                        ...book,
                        isbn: isbn,
                        author: author
                    };
                } catch (error) {
                    console.error(`Error fetching data for book ${book.title}:`, error);
                    return {
                        ...book,
                        isbn: 'Error fetching ISBN',
                        author: 'Error fetching author'
                    };
                }
            }));

            res.render("home.ejs", {
                name: req.user.username,
                listBooks,
                currentPage: page,
                totalPages: totalPages,
            });
        } catch (err) {
            console.log(err);
            res.redirect("/login");
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/deleteBook", async (req, res) => {
    const book_id = req.body.deleteBookId;
    const user_id = req.user.id

    if (req.isAuthenticated()) {
        try {
            await db.query("DELETE FROM books WHERE id = $1 AND user_id = $2", 
                [book_id, user_id]
            );
            req.flash("success", "Book deleted successfully!");
            res.redirect('/home');
        } catch (err) {
            console.log(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/editBook", async (req, res) => {
    const book_id = req.body.bookId;
    const user_id = req.user.id;
    const notes = req.body.notes

    if (req.isAuthenticated()) {
        try {
            await db.query("UPDATE books SET description = $1 WHERE id = $2 AND user_id = $3", 
                [notes, book_id, user_id]
            )
            req.flash("success", "Book updated successfully!");
            res.redirect('/home')
        } catch (err) {
            console.log(err)
            req.flash("error", "An error occurred while updating the book.");
            res.redirect('/home');
        }
    } else {
        res.redirect("/login");
    }
})

app.get(
    "/auth/google", 
    passport.authenticate("google", {
        scope: ["profile", "email"],
    })
)

app.get(
    "/auth/google/home", 
    passport.authenticate("google", {
        successRedirect: "/home",
        failureRedirect: "/login",
    })
)

app.get("/logout", (req, res) => {
    req.logout((err) => {
        if (err) console.log(err)
        res.redirect("/")
    })
})

app.post(
    "/login", 
    passport.authenticate("local", {
        successRedirect: "/home",
        failureRedirect: "/login",
        failureFlash: true
    })
)

app.post("/register", async (req, res) => {
    const { name, email, password } = req.body

    try {
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", 
            [email]
        )
    
        if (checkResult.rows.length > 0) {
            req.flash("error", "Email already exists")
            res.redirect("/register")
        } else {
            // hash da senha e salvando-a no banco de dados
            bcrypt.hash(password, saltRounds, async (err, hash) => {
                if (err) {
                    console.log("Error hashing password: ", err)
                } else {
                    const result = await db.query(
                        "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *",
                        [name, email, hash]
                    )
                    const user = result.rows[0]
                    req.login(user, (err) => {
                        console.log(err)
                        res.redirect("/home")
                    })
                }
            })
        }
    } catch (err) {
        console.log(err)
    }
})

passport.use("local",
    new Strategy(async function verify(username, password, cb) {
        console.log(username)
        try {
            const result = await db.query("SELECT * FROM users WHERE email = $1", 
                [username]
            )
            
            if (result.rows.length > 0) {
                const user = result.rows[0]
                const storedHashedPassword = user.password

                bcrypt.compare(password, storedHashedPassword, (err, result) => {
                    if (err) {
                        return cb(err)
                    } else {
                        if (result) {
                            return cb(null, user)
                        } else {
                            //res.render("login.ejs", { error: "Incorrect password" })
                            return cb(null, false, { message: "Incorrect password" })
                        }
                    }
                })

            } else {
                //res.render("login.ejs", { error: "User not found" })
                return cb(null, false, { message: "User not found" })
            }
        } catch (err) {
            return cb(err)
        }
    })
)

passport.use(
    "google", 
    new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "http://localhost:3000/auth/google/home",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    }, async (accessToken, refreshToken, profile, cb) => {
        console.log(profile)
        try {
            const result = await db.query("SELECT * FROM users WHERE email = $1", [profile.email])

            if (result.rows.length === 0) {
                const newUser = await db.query("INSERT INTO users (username, email, password) VALUES ($1, $2, $3)",
                    [profile.displayName, profile.email, "google"]
                )
                cb(null, newUser.rows[0])
            } else {
                // Usuário já existente
                cb(null, result.rows[0], { message: "Already existing user" })
            }
        } catch (err) {
            cb(err)
        }
    })
)

passport.serializeUser((user, cb) => {
    cb(null, user)
})

passport.deserializeUser((user, cb) => {
    cb(null, user)
})

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})