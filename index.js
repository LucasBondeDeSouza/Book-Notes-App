import express from "express"
import rateLimit from 'express-rate-limit';
import bodyParser from "body-parser"
import bcrypt from "bcrypt"
import session from "express-session"
import passport from "passport"
import { Strategy } from "passport-local"
import GoogleStrategy from "passport-google-oauth2"
import flash from "connect-flash"
import axios from "axios"
import path from "path";
import { fileURLToPath } from 'url';

import pool from "./config/db.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express()
const port = 3000
const saltRounds = 10

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static("public"))
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

app.use(passport.initialize());
app.use(passport.session());
app.use(flash())

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // Bloqueia após 5 tentativas
    handler: function (req, res, next) {
        req.flash('error', "Too many login attempts. Please try again after 15 minutes.");
        res.redirect('/login');
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use((req, res, next) => {
    res.locals.error = req.flash("error")
    res.locals.success = req.flash("success")
    next()
})

// Função reutilizável para buscar dados do livro na API OpenLibrary
async function fetchBookData(book) {
    try {
        const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${book.title}`);
        const cover = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].cover_i) ? searchBook.data.docs[0].cover_i : 'cover Not Found';
        const author = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].author_name) ? searchBook.data.docs[0].author_name[0] : 'Author Not Found';

        return {
            ...book,
            cover: cover,
            author: author,
        };
    } catch (error) {
        console.error(`Error fetching data for book ${book.title}:`, error);
        return {
            ...book,
            cover: 'Error fetching cover',
            author: 'Error fetching author',
        };
    }
}

app.get("/", (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect("/home");
    } else {
        res.redirect("/login")
    }
})

app.get("/login", (req, res) => {
    res.render("login.ejs")
})

app.get("/register", (req, res) => {
    res.render("register.ejs")
})

app.get("/profile", async (req, res) => {
    if (req.isAuthenticated()) {
        const page = parseInt(req.query.page) || 1;
        const limit = 6; // Número de livros por página
        const offset = (page - 1) * limit;

        try {
            const result = await pool.query(
                `SELECT b.id AS book_id, b.title, b.review, b.rating,
                        CASE WHEN l.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_user,
                        COALESCE(likes_count.count, 0) AS like_count
                FROM books b
                LEFT JOIN likes l ON b.id = l.book_id AND l.user_id = $1
                LEFT JOIN (
                    SELECT book_id, COUNT(*) AS count
                    FROM likes
                    GROUP BY book_id
                ) likes_count ON b.id = likes_count.book_id
                WHERE b.user_id = $2
                ORDER BY b.id DESC
                LIMIT $3 OFFSET $4`,
                [req.user.id, req.user.id, limit, offset]
            );

            const countResult = await pool.query(
                `SELECT COUNT(*)
                FROM books b
                LEFT JOIN likes l ON b.id = l.book_id AND l.user_id = $1
                LEFT JOIN (
                    SELECT book_id, COUNT(*) AS count
                    FROM likes
                    GROUP BY book_id
                ) likes_count ON b.id = likes_count.book_id
                WHERE b.user_id = $2`,
                [req.user.id, req.user.id]
            );

            const totalBooks = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(totalBooks / limit);

            const listBooks = await Promise.all(result.rows.map(async (row) => {
                const book = {
                    title: row.title,
                    review: row.review,
                    rating: row.rating,
                    bookId: row.book_id,
                    liked_by_user: row.liked_by_user,
                    like_count: row.like_count
                };
                return fetchBookData(book);
            }));

            const followersResult = await pool.query(
                "SELECT u.id, u.username, u.picture FROM users u JOIN followers f ON u.id = f.followed_id WHERE f.follower_id = $1",
                [req.user.id]
            );

            const followers = followersResult.rows;

            // Contar Seguidores (quem segue o usuário)
            const countFollowers = await pool.query(
                "SELECT COUNT(*) FROM followers WHERE followed_id = $1",
                [req.user.id]
            );
            const totalFollowers = countFollowers.rows[0].count;

            // Contar Seguindo (quem o usuário está seguindo)
            const countFollowing = await pool.query(
                "SELECT COUNT(*) FROM followers WHERE follower_id = $1",
                [req.user.id]
            );
            const totalFollowing = countFollowing.rows[0].count;

            res.render("home.ejs", {
                id: req.user.id,
                name: req.user.username,
                userPicture: req.user.picture,
                yourBooks: listBooks,
                currentPage: page,
                totalPages: totalPages,
                followers,
                totalBooks,
                totalFollowers,
                totalFollowing
            });
        } catch (err) {
            console.log(err);
            res.redirect("/login");
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/newBook", async (req, res) => {
    const { title, review, rating } = req.body

    if (req.isAuthenticated()) {
        try {
            const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${title}`);
            if (searchBook.data.docs.length > 0) {
                await pool.query(
                    "INSERT INTO books (title, review, user_id, rating) VALUES ($1, $2, $3, $4)", 
                    [title, review, req.user.id, rating]
                );
                req.flash("success", "Book added successfully!");
                res.redirect('/profile');
            } else {
                req.flash("error", "Unable to add Book!");
                res.redirect('/profile');
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
            const result = await pool.query(
                `SELECT u.id AS user_id, u.username, u.picture, b.id AS book_id, b.title, b.review, b.rating,
                        CASE WHEN l.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_user,
                        COALESCE(likes_count.count, 0) AS like_count
                FROM (
                    SELECT * FROM books
                    ORDER BY id DESC
                    LIMIT 52
                ) b
                JOIN users u ON b.user_id = u.id
                JOIN followers f ON u.id = f.followed_id
                LEFT JOIN likes l ON b.id = l.book_id AND l.user_id = $1
                LEFT JOIN (
                    SELECT book_id, COUNT(*) AS count
                    FROM likes
                    GROUP BY book_id
                ) likes_count ON b.id = likes_count.book_id
                WHERE f.follower_id = $1
                ORDER BY b.id DESC
                LIMIT $2 OFFSET $3`,
                [req.user.id, limit, offset]
            );

            // Atualize o countResult para contar apenas os 50 livros mais recentes
            const countResult = await pool.query(
                `SELECT COUNT(*)
                FROM (
                    SELECT * FROM books
                    ORDER BY id DESC
                    LIMIT 52
                ) b
                JOIN users u ON b.user_id = u.id
                JOIN followers f ON u.id = f.followed_id
                WHERE f.follower_id = $1`,
                [req.user.id]
            );

            const totalBooks = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(totalBooks / limit);

            const listBooks = await Promise.all(result.rows.map(async (row) => {
                const book = {
                    title: row.title,
                    review: row.review,
                    rating: row.rating,
                    userId: row.user_id,
                    bookId: row.book_id,
                    username: row.username,
                    picture: row.picture,
                    liked_by_user: row.liked_by_user,
                    like_count: row.like_count
                };
                return fetchBookData(book);
            }));

            const followersResult = await pool.query(
                "SELECT u.id, u.username, u.picture FROM users u JOIN followers f ON u.id = f.followed_id WHERE f.follower_id = $1",
                [req.user.id]
            );

            const followers = followersResult.rows;

            res.render("home.ejs", {
                name: req.user.username,
                userPicture: req.user.picture,
                booksTimeline: listBooks,
                currentPage: page,
                totalPages: totalPages,
                followers
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
            await pool.query("DELETE FROM books WHERE id = $1 AND user_id = $2", 
                [book_id, user_id]
            );
            req.flash("success", "Book deleted successfully!");
            res.redirect('/profile');
        } catch (err) {
            console.log(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/editBook", async (req, res) => {
    const { bookId, review, rating } = req.body
    const user_id = req.user.id;

    if (req.isAuthenticated()) {
        try {
            await pool.query("UPDATE books SET review = $1, rating = $2 WHERE id = $3 AND user_id = $4", 
                [review, rating, bookId, user_id]
            )
            req.flash("success", "Book updated successfully!");
            res.redirect('/profile')
        } catch (err) {
            console.log(err)
            req.flash("error", "An error occurred while updating the book.");
            res.redirect('/profile');
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/search/user", async (req, res) => {
    const username = req.query.username

    const page = parseInt(req.query.page) || 1;
    const limit = 9; // Número de livros por página
    const offset = (page - 1) * limit;

    if (req.isAuthenticated()) {
        try {
            const result = await pool.query(
                `SELECT u.*, COUNT(f.followed_id) AS follower_count
                FROM users u
                LEFT JOIN followers f ON u.id = f.followed_id
                WHERE u.username ILIKE $1
                GROUP BY u.id
                ORDER BY follower_count DESC
                LIMIT $2 OFFSET $3`,
                [`%${username}%`, limit, offset]
            );

            const listSearchUser = result.rows

            const countResult = await pool.query(
                "SELECT COUNT(*) FROM users WHERE username ILIKE $1",
                [`%${username}%`]
            );

            const totalBooks = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(totalBooks / limit);

            const followingResult = await pool.query(
                "SELECT followed_id FROM followers WHERE follower_id = $1",
                [req.user.id]
            );

            const followingIds = followingResult.rows.map(row => row.followed_id);

            for (let user of listSearchUser) {
                const bookCountResult = await pool.query("SELECT COUNT(*) FROM books WHERE user_id = $1", [user.id]);
                user.book_count = bookCountResult.rows[0].count;
                user.isFollowing = followingIds.includes(user.id);
            }

            // Obtenha os seguidores para a visualização
            const followersResult = await pool.query(
                "SELECT u.id, u.username, u.picture FROM users u JOIN followers f ON u.id = f.followed_id WHERE f.follower_id = $1",
                [req.user.id]
            );

            const followers = followersResult.rows;
                
            res.render("home.ejs", { 
                name: req.user.username,
                userPicture: req.user.picture,
                listUser: listSearchUser,
                currentPage: page,
                totalPages: totalPages,
                username: username,
                followers
            })
            
        } catch(err) {
            console.log(err)
        }

    } else {
        res.redirect("/login");
    }
})

app.get("/search/book", async (req, res) => {
    const book = req.query.title

    const page = parseInt(req.query.page) || 1;
    const limit = 6; // Número de livros por página
    const offset = (page - 1) * limit;

    if (req.isAuthenticated()) {
        try {
            const result = await pool.query(
                `SELECT u.id, u.username, u.picture, b.title, b.review, b.rating, COUNT(f.followed_id) AS follower_count
                FROM books b 
                JOIN users u ON b.user_id = u.id 
                LEFT JOIN followers f ON u.id = f.followed_id
                WHERE b.title ILIKE $1 
                GROUP BY u.id, b.id
                ORDER BY follower_count DESC, b.id DESC 
                LIMIT $2 OFFSET $3`, 
                [`%${book}%`, limit, offset]
            );
            
            const countResult = await pool.query(
                `SELECT COUNT(*) FROM books b 
                 JOIN users u ON b.user_id = u.id 
                 WHERE b.title ILIKE $1`,
                 [`%${book}%`]
            )

            const totalBooks = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(totalBooks / limit);

            const bookData = await pool.query(
                `SELECT 
                    ROUND(AVG(rating), 1) AS average_rating,
                    COUNT(*) AS count
                FROM books
                WHERE title ILIKE $1`,
                [`%${book}%`]
            );
            
            const averageRating = bookData.rows[0].average_rating;
            const count = bookData.rows[0].count;
            
            console.log(`Average Rating: ${averageRating}`);
            console.log(`Count: ${count}`);            

            const listSearchBook = await Promise.all(result.rows.map(async (book) => {
                try {
                    const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${book.title}`);
                    const cover = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].cover_i) ? searchBook.data.docs[0].cover_i : 'cover Not Found';
                    const author = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].author_name) ? searchBook.data.docs[0].author_name[0] : 'Author Not Found';

                    return {
                        ...book,
                        cover: cover,
                        author: author
                    };
                } catch (error) {
                    console.error(`Error fetching data for book ${book.title}:`, error);
                    return {
                        ...book,
                        cover: 'Error fetching cover',
                        author: 'Error fetching author'
                    };
                }
            }));

            // Obtenha os seguidores para a visualização
            const followersResult = await pool.query(
                "SELECT u.id, u.username, u.picture FROM users u JOIN followers f ON u.id = f.followed_id WHERE f.follower_id = $1",
                [req.user.id]
            );

            const followers = followersResult.rows;
            
            res.render("home.ejs", {
                name: req.user.username,
                userPicture: req.user.picture,
                followers,
                listBook: listSearchBook,
                listBookData: bookData.rows,
                book,
                currentPage: page,
                totalPages: totalPages,
            })
        } catch (err) {
            console.log(err)
        }
        
    } else {
        res.redirect("/login");
    }
})

app.get("/user/profile", async (req, res) => {
    const user_id = req.query.userId;

    const page = parseInt(req.query.page) || 1;
    const limit = 6; // Número de livros por página
    const offset = (page - 1) * limit;

    const followingResult = await pool.query(
        "SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2",
        [req.user.id, user_id]
    );

    const isFollowing = followingResult.rowCount > 0;

    if (req.isAuthenticated()) {
        if (user_id == req.user.id) {
            res.redirect('/profile');
        } else {
            try {
                const result = await pool.query(
                    `SELECT b.id AS book_id, b.title, b.review, b.rating,
                            CASE WHEN l.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_user,
                            COALESCE(likes_count.count, 0) AS like_count,
                            u.username, u.picture
                    FROM books b
                    LEFT JOIN users u ON u.id = b.user_id
                    LEFT JOIN likes l ON b.id = l.book_id AND l.user_id = $1
                    LEFT JOIN (
                        SELECT book_id, COUNT(*) AS count
                        FROM likes
                        GROUP BY book_id
                    ) likes_count ON b.id = likes_count.book_id
                    WHERE b.user_id = $2
                    ORDER BY b.id DESC
                    LIMIT $3 OFFSET $4`,
                    [req.user.id, user_id, limit, offset]
                );

                const countResult = await pool.query(
                    `SELECT COUNT(*)
                    FROM books b
                    LEFT JOIN likes l ON b.id = l.book_id AND l.user_id = $1
                    LEFT JOIN (
                        SELECT book_id, COUNT(*) AS count
                        FROM likes
                        GROUP BY book_id
                    ) likes_count ON b.id = likes_count.book_id
                    WHERE b.user_id = $2`,
                    [req.user.id, user_id]
                );

                const totalBooks = parseInt(countResult.rows[0].count);
                const totalPages = Math.ceil(totalBooks / limit);

                const searchedUser = await Promise.all(result.rows.map(async (row) => {
                    try {
                        const searchBook = await axios.get(`https://openlibrary.org/search.json?title=${row.title}`);
                        const cover = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].cover_i) ? searchBook.data.docs[0].cover_i : 'cover Not Found';
                        const author = (searchBook.data.docs.length > 0 && searchBook.data.docs[0].author_name) ? searchBook.data.docs[0].author_name[0] : 'Author Not Found';

                        return {
                            ...row,
                            cover: cover,
                            author: author
                        };
                    } catch (error) {
                        console.error(`Error fetching data for book ${row.title}:`, error);
                        return {
                            ...row,
                            cover: 'Error fetching cover',
                            author: 'Error fetching author'
                        };
                    }
                }));

                const followersResult = await pool.query(
                    "SELECT u.id, u.username, u.picture FROM users u JOIN followers f ON u.id = f.followed_id WHERE f.follower_id = $1",
                    [req.user.id]
                );

                const followers = followersResult.rows;

                // Contar Seguidores (quem segue o usuário)
                const countFollowers = await pool.query(
                    "SELECT COUNT(*) FROM followers WHERE followed_id = $1",
                    [user_id]
                );
                const totalFollowers = countFollowers.rows[0].count;

                // Contar Seguindo (quem o usuário está seguindo)
                const countFollowing = await pool.query(
                    "SELECT COUNT(*) FROM followers WHERE follower_id = $1",
                    [user_id]
                );
                const totalFollowing = countFollowing.rows[0].count;

                res.render('home.ejs', {
                    name: req.user.username,
                    userPicture: req.user.picture,
                    searchedUser,
                    currentPage: page,
                    totalPages: totalPages,
                    user_id,
                    isFollowing,
                    followers,
                    totalBooks,
                    totalFollowers,
                    totalFollowing
                });

            } catch (err) {
                console.log(err);
                res.redirect("/login");
            }
        }
    } else {
        res.redirect("/login");
    }
});

app.post('/follow', async (req, res) => {
    const followerId = req.user.id;
    const followedId = req.body.userId;

    if (req.isAuthenticated()) {
        try {
            await pool.query('INSERT INTO followers (follower_id, followed_id) VALUES ($1, $2)',
                [followerId, followedId]
            )
    
            res.redirect(req.get('Referer'));
        } catch (err) {
            console.log(err)
        }
    } else {
        res.redirect("/login");
    }
})

app.post('/unfollow', async (req, res) => {
    const followerId = req.user.id;
    const followedId = req.body.userId;

    if (req.isAuthenticated()) {
        try {
            await pool.query('DELETE FROM followers WHERE follower_id = $1 AND followed_id = $2',
                [followerId, followedId]
            )

            res.redirect(req.get('Referer'));
        } catch (err) {
            console.log(err)
        }
    } else {
        res.redirect("/login");
    }
})

app.get('/followers', async (req, res) => {
    const userId = req.query.user_id;
    const loggedInUserId = req.user.id;

    if (req.isAuthenticated()) {
        try {
            const followersResult = await pool.query(
                `SELECT u.id, u.username, u.picture, 
                        EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = $1 AND f.followed_id = u.id) AS isFollowing 
                 FROM users u 
                 JOIN followers f ON u.id = f.follower_id 
                 WHERE f.followed_id = $2`,
                [loggedInUserId, userId]
            );

            const followers = followersResult.rows;
            res.json(followers);
        } catch (err) {
            console.log(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.get('/following', async (req, res) => {
    const userId = req.query.user_id;
    const loggedInUserId = req.user.id;

    try {
        const followingResult = await pool.query(
            `SELECT u.id, u.username, u.picture, 
                EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = $1 AND f.followed_id = u.id) AS isFollowing
            FROM users u 
            JOIN followers f ON u.id = f.followed_id 
            WHERE f.follower_id = $2`,
            [loggedInUserId, userId]
        );

        const followings = followingResult.rows;
        res.json(followings);
    } catch (err) {
        console.log(err);
    }
});

// Like a book
app.post('/book/like', async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.id;

    if (req.isAuthenticated()) {
        try {
            const existingLike = await pool.query(
                'SELECT * FROM likes WHERE user_id = $1 AND book_id = $2',
                [userId, bookId]
            );
    
            if (existingLike.rows.length === 0) {
                // Inserir um novo like
                await pool.query(
                    'INSERT INTO likes (user_id, book_id) VALUES ($1, $2)',
                    [userId, bookId]
                );
            } else {
                // Remover o like existente
                await pool.query(
                    'DELETE FROM likes WHERE user_id = $1 AND book_id = $2',
                    [userId, bookId]
                );
            }

            // Contar o número atualizado de likes
            const likeCountResult = await pool.query(
                'SELECT COUNT(*) FROM likes WHERE book_id = $1',
                [bookId]
            );

            const likeCount = parseInt(likeCountResult.rows[0].count);
            const liked = existingLike.rows.length === 0; // Se antes não tinha like, agora tem

            res.json({ liked, likeCount });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        res.redirect("/login");
    }
});

// Unlike a book
app.post('/book/unlike', async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.id;

    if (req.isAuthenticated()) {
        try {
            // Remove o like
            await pool.query(
                'DELETE FROM likes WHERE user_id = $1 AND book_id = $2',
                [userId, bookId]
            );
        } catch (err) {
            console.error(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.get('/likes', async (req, res) => {
    const bookId = req.query.book_id;
    const loggedInUserId = req.user.id;

    try {
        const likesResult = await pool.query(
            `SELECT u.id, u.username, u.picture,
                    EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = $1 AND f.followed_id = u.id) AS isFollowing
             FROM users u
             JOIN likes l ON u.id = l.user_id
             WHERE l.book_id = $2`,
            [loggedInUserId, bookId]
        );

        const users = likesResult.rows;
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar usuários que curtiram este livro.' });
    }
});


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
    "/login", loginLimiter, 
    passport.authenticate("local", {
        successRedirect: "/home",
        failureRedirect: "/login",
        failureFlash: true
    })
)

app.post("/register", async (req, res) => {
    const { name, email, password } = req.body

    try {
        const checkResult = await pool.query("SELECT * FROM users WHERE email = $1", 
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
                    const result = await pool.query(
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
            const result = await pool.query("SELECT * FROM users WHERE email = $1", 
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
        callbackURL: "https://litshare.vercel.app/auth/google/home",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    }, async (accessToken, refreshToken, profile, cb) => {
        console.log(profile)
        try {
            const result = await pool.query("SELECT * FROM users WHERE email = $1", [profile.email])

            if (result.rows.length === 0) {
                const newUser = await pool.query("INSERT INTO users (username, email, password, picture) VALUES ($1, $2, $3, $4)",
                    [profile.displayName, profile.email, "google", profile.picture]
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