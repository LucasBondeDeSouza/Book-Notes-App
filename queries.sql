CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100)
    picture TEXT
);

CREATE TABLE books(
    id SERIAL PRIMARY KEY,
    title TEXT,
    description TEXT,
    rating INT,
    user_id INTEGER REFERENCES users(id)
);

CREATE TABLE followers (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER REFERENCES users(id),
    followed_id INTEGER REFERENCES users(id),
    UNIQUE (follower_id, followed_id)
);