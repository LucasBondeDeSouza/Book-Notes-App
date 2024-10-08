import nodemailer from "nodemailer"
import pg from "pg"

// Função para enviar e-mail
const sendEmail = (email, userName) => {
    let transporter = nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: {
            user: process.env.NODEMAILER_USER,
            pass: process.env.NODEMAILER_PASS
        },
        tls: {
            rejectUnauthorized: false // Ignora certificados autoassinados
        }
    });

    let mailOptions = {
        from: '"LitShare" litshareapp@gmail.com',
        to: email,
        subject: 'Você tem um novo seguidor!',
        html: `
            <h1>Você tem um novo seguidor!</h1>
            <p>${userName} começou a te seguir!</p>

            <a href='https://litshare.vercel.app' class='my-4 btn btn-primary' role="button">
                Visite o LitShare
            </a>
        `
    };

    // Envia o e-mail
    return transporter.sendMail(mailOptions)
        .then(info => console.log("Email enviado: " + info.response))
        .catch(error => console.log(error));
}

export default sendEmail