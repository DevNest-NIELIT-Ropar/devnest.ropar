'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { FaGithub, FaLinkedin, FaInstagram, FaDiscord, FaEnvelope, FaChevronDown, FaPaperPlane, FaWhatsapp } from 'react-icons/fa';
import { faqData } from '@/lib/data';
import { addContact } from '@/lib/services';

export default function ContactPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      toast.error('Please fill in all fields.');
      return;
    }

    setSubmitting(true);
    const res = await addContact({
      ...formData,
      createdAt: new Date().toISOString(),
      read: false,
    });
    setSubmitting(false);

    if (!res.error) {
      toast.success('Message sent! We will get back to you soon. 🚀');
      setFormData({ name: '', email: '', message: '' });
    } else {
      toast.error('Failed to send message. Please try again.');
    }
  };

  return (
    <div className="container page-enter page-enter-active" style={{ padding: '4rem 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 800, marginBottom: '1rem' }}>
          Get In <span className="gradient-text">Touch</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '700px', margin: '0 auto' }}>
          Have a question or want to join? Drop us a message — we read every one.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4rem', marginBottom: '6rem' }}>
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <div style={{ background: 'var(--bg-card)', padding: '2.5rem', borderRadius: '24px', border: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '1.5rem', color: 'var(--text-primary)' }}>Ask a query</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Your Name *</label>
                <input
                  required
                  type="text"
                  className="form-input"
                  placeholder="Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address *</label>
                <input
                  required
                  type="email"
                  className="form-input"
                  placeholder="Email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Query *</label>
                <textarea
                  required
                  className="form-input"
                  placeholder="Write your query here..."
                  rows={4}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '16px' }}
                disabled={submitting}
              >
                <FaPaperPlane />
                {submitting ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <h2 style={{ fontSize: '1.8rem', marginBottom: '1.5rem', color: 'var(--text-primary)' }}>Find Us</h2>

          <div style={{ background: 'var(--bg-card)', padding: '2rem', borderRadius: '24px', border: '1px solid var(--border)', marginBottom: '2rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Connect with us on social platforms</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <a href="https://github.com/DevNest-NIELIT-Ropar" target="_blank" rel="noreferrer" className="contact-social-link"><FaGithub /></a>
              <a href="https://www.linkedin.com/company/devnest-ropar" target="_blank" rel="noreferrer" className="contact-social-link"><FaLinkedin /></a>
              <a href="https://www.instagram.com/devnest_nielitropar" target="_blank" rel="noreferrer" className="contact-social-link"><FaInstagram /></a>
              <a href="https://chat.whatsapp.com/ExpQEovO5YUEt2KKdBXOu9" target="_blank" rel="noreferrer" className="contact-social-link"><FaWhatsapp /></a>
              <a href="mailto:devnest.ropar@nielit.ac.in" className="contact-social-link"><FaEnvelope /></a>
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '2rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
              📍 NIELIT Main Campus<br />
              Chhota Phull, Rupnagar (Ropar)<br />
              Punjab, 140001<br /><br />
              📧 devnest.ropar@nielit.ac.in<br />
              ⏰ Mon–Sat, 10am–6pm
            </p>
          </div>
          <div style={{ height: '280px', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3421.2011354506326!2d76.48466827562017!3d30.9648687744731!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390554e38f06ea2f%3A0x75c175701d758d5d!2sNIELIT%20Ropar%20Campus!5e0!3m2!1sen!2sin!4v1790021681541!5m2!1sen!2sin"
              width="100%"
              height="100%"
              style={{ border: 0, filter: 'invert(90%) hue-rotate(180deg) contrast(100%)' }}
              allowFullScreen={false}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </motion.div>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h2 className="section-title" style={{ textAlign: 'center', display: 'block', margin: '0 auto 3rem auto' }}>Frequently Asked Questions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {faqData.map((faq, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{ width: '100%', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600, textAlign: 'left' }}
              >
                {faq.question}
                <motion.div animate={{ rotate: openFaq === i ? 180 : 0 }}>
                  <FaChevronDown style={{ color: 'var(--accent)', flexShrink: 0 }} />
                </motion.div>
              </button>
              <AnimatePresence>
                {openFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ padding: '0 20px 20px 20px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}