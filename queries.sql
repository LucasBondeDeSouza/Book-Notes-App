CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    username VARCHAR(50),
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100),
    picture TEXT
);

CREATE TABLE books(
    id SERIAL PRIMARY KEY,
    title TEXT,
    review TEXT,
    rating INT,
    user_id INTEGER REFERENCES users(id)
);

CREATE TABLE followers (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER REFERENCES users(id),
    followed_id INTEGER REFERENCES users(id),
    UNIQUE (follower_id, followed_id)
);

CREATE TABLE likes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    book_id INTEGER REFERENCES books(id),
    UNIQUE (user_id, book_id)
);