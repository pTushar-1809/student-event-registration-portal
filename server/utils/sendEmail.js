const nodemailer = require('nodemailer');

let transporterPromise;

function getTransporter() {
    if (!transporterPromise) {
        transporterPromise = (async () => {
            const usesSmtp = Boolean(process.env.SMTP_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
            if (usesSmtp) {
                const port = Number(process.env.SMTP_PORT) || 587;
                return {
                    transporter: nodemailer.createTransport({
                        host: process.env.SMTP_HOST,
                        port,
                        secure: process.env.SMTP_SECURE
                            ? process.env.SMTP_SECURE === 'true'
                            : port === 465,
                        auth: {
                            user: process.env.EMAIL_USER,
                            pass: process.env.EMAIL_PASS,
                        },
                    }),
                    isPreview: false
                };
            }

            const testAccount = await nodemailer.createTestAccount();
            return {
                transporter: nodemailer.createTransport({
                    host: testAccount.smtp.host,
                    port: testAccount.smtp.port,
                    secure: testAccount.smtp.secure,
                    auth: {
                        user: testAccount.user,
                        pass: testAccount.pass,
                    },
                }),
                isPreview: true
            };
        })();
    }
    return transporterPromise;
}

const sendEmail = async (options) => {
    try {
        const { transporter, isPreview } = await getTransporter();

        const message = {
            from: process.env.EMAIL_FROM || '"College Portal Admin" <admin@collegeportal.com>',
            to: options.email,
            subject: options.subject,
            text: options.message,
            html: options.html || `<p>${options.message}</p>`,
        };

        const info = await transporter.sendMail(message);
        console.log('Message sent: %s', info.messageId);
        const previewUrl = isPreview ? nodemailer.getTestMessageUrl(info) : null;
        if (previewUrl) console.log('Preview URL: %s', previewUrl);
        return { sent: true, previewUrl };
    } catch (error) {
        console.error('Error sending email:', error);
        return { sent: false, previewUrl: null };
    }
};

module.exports = sendEmail;