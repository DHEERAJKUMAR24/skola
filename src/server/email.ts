export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

/** Sends through Resend's REST API. Without a key, dev prints the mail; production refuses. */
export const sendEmail: Mailer = async (mail) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production")
      throw new Error("RESEND_API_KEY is not set");
    console.warn(
      `[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`
    );
    return;
  }
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
};
