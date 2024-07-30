CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100)
);

CREATE TABLE books(
    id SERIAL PRIMARY KEY,
    title TEXT,
    description TEXT,
    user_id INTEGER REFERENCES users(id)
);