import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

async function sendViaSmtp(mail: Mail): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}

async function sendViaResend(mail: Mail, key: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Skola++ <onboarding@resend.dev>",
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`email send failed: ${res.status}`);
}

/** Sends via Resend (if RESEND_API_KEY set), SMTP (if SMTP_HOST set), or logs in dev. */
export const sendEmail: Mailer = async (mail) => {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) return sendViaResend(mail, resendKey);

  if (process.env.SMTP_HOST) return sendViaSmtp(mail);

  if (process.env.NODE_ENV === "production")
    throw new Error("No email transport configured (set RESEND_API_KEY or SMTP_* vars)");

  console.warn(
    `[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`
  );
};
