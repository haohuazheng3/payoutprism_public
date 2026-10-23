import { PageShell } from "@/components/PageShell";
import { ContactForm } from "@/components/ContactForm";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Contact",
  description: `Report a fee that changed, ask for a new calculator, or say hello. Write to ${SITE.email} or use the form; we reply within two business days.`,
  path: "/contact",
});

export default function ContactPage() {
  return (
    <PageShell
      title="Contact"
      path="/contact"
      dek={
        <>
          Spotted a fee that changed before we did? That’s the message we most want. You can also ask for a calculator we don’t have yet. Write to{" "}
          <a href={`mailto:${SITE.email}`} className="link">
            {SITE.email}
          </a>{" "}
          or use the form. {SITE.replyTime}
        </>
      }
    >
      <ContactForm />
    </PageShell>
  );
}
