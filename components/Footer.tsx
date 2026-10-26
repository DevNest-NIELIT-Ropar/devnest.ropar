'use client';
import Link from 'next/link';
import Image from 'next/image';
import { FaGithub, FaLinkedin, FaInstagram, FaEnvelope, FaWhatsapp } from 'react-icons/fa';

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', marginTop: '4rem' }}>
      <div className="container" style={{ padding: '48px 20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
          <div>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Image
                  src="/devnest-logo.png"
                  alt="DevNest"
                  width={28}
                  height={28}
                  style={{ borderRadius: '6px' }}
                />
                <span style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  color: 'var(--text-primary)',
                }}>
                  DevNest
                </span>
              </div>
              <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
              <Image
                src="/nielit-logo.png"
                alt="NIELIT"
                width={50}
                height={24}
                style={{ objectFit: 'contain' }}
              />
            </Link>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '300px' }}>
              The official coding club of NIELIT ROPAR. We build, we learn, we grow, we code. Join us to explore the world of technology.
            </p>
          </div>

          <div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1.2rem', color: 'var(--text-primary)' }}>Quick Links</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {['Home', 'About', 'Events', 'Projects', 'Blog', 'Members'].map(link => (
                <li key={link}>
                  <Link href={link === 'Home' ? '/' : `/${link.toLowerCase()}`} style={{ color: 'var(--text-muted)', fontSize: '0.9rem', transition: 'color 0.2s' }}>
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1.2rem', color: 'var(--text-primary)' }}>Connect</h3>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <a target='_blank' href="https://github.com/DevNest-NIELIT-Ropar" style={{ color: 'var(--text-muted)', fontSize: '1.5rem', transition: 'color 0.2s' }}><FaGithub /></a>
              <a target='_blank' href="https://www.linkedin.com/company/devnest-ropar" style={{ color: 'var(--text-muted)', fontSize: '1.5rem', transition: 'color 0.2s' }}><FaLinkedin /></a>
              <a target='_blank' href="https://chat.whatsapp.com/ExpQEovO5YUEt2KKdBXOu9" style={{ color: 'var(--text-muted)', fontSize: '1.5rem', transition: 'color 0.2s' }}><FaWhatsapp /></a>
              <a target='_blank' href="https://www.instagram.com/devnest_nielitropar" style={{ color: 'var(--text-muted)', fontSize: '1.5rem', transition: 'color 0.2s' }}><FaInstagram /></a>
              <a target='_blank' href="mailto:devnest.ropar@nielit.ac.in" style={{ color: 'var(--text-muted)', fontSize: '1.5rem', transition: 'color 0.2s' }}><FaEnvelope /></a>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1.5rem' }}>
              NIELIT Main Campus<br />
              Chhota Phull, Rupnagar (Ropar)<br />
              Punjab, 140001
            </p>
          </div>
        </div>

        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: '24px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          color: 'var(--text-dim)',
          fontSize: '0.85rem'
        }}>
          <p>© {new Date().getFullYear()} DevNest · NIELIT. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}