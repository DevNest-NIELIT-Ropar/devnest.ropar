'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FaExclamationTriangle } from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function MemberApplyPage() {
  const [formLoading, setFormLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    registrationNumber: '',
    password: '',
    image: '',
    bio: '',
    github: '',
    linkedin: '',
    twitter: ''
  });

  // Load draft from localStorage on mount (excluding password)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('devnest_apply_draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        setFormData(prev => ({
          ...prev,
          name: parsed.name || '',
          email: parsed.email || '',
          registrationNumber: parsed.registrationNumber || '',
          image: parsed.image || '',
          bio: parsed.bio || '',
          github: parsed.github || '',
          linkedin: parsed.linkedin || '',
          twitter: parsed.twitter || ''
        }));
      }
    } catch (_) {}
  }, []);

  const updateFormField = (field: string, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field !== 'password') {
        try {
          const { password: _, ...draft } = next;
          localStorage.setItem('devnest_apply_draft', JSON.stringify(draft));
        } catch (_) {}
      }
      return next;
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.bio.length > 500) {
      toast.error('Bio must be under 500 characters');
      return;
    }

    const regNum = formData.registrationNumber.trim().toUpperCase();
    if (!regNum) {
      toast.error('Registration Number is required');
      return;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }

    setFormLoading(true);

    try {
      const res = await fetch('/api/members/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          registrationNumber: regNum,
          password: formData.password,
          image: formData.image.trim(),
          bio: formData.bio.trim(),
          github: formData.github.trim(),
          linkedin: formData.linkedin.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to submit application.');
      } else {
        toast.success(data.message || 'Application submitted! You will be notified once approved.');
        try {
          localStorage.removeItem('devnest_apply_draft');
        } catch (_) {}
        setFormData({
          name: '',
          email: '',
          registrationNumber: '',
          password: '',
          image: '',
          bio: '',
          github: '',
          linkedin: '',
          twitter: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to submit application. Please check your connection and try again.');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="container page-enter page-enter-active" style={{ padding: '4rem 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 800, marginBottom: '1rem' }}>
          Join <span className="gradient-text">DevNest</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '700px', margin: '0 auto 1.5rem auto' }}>
          Submit your details below to apply for membership. Your application will be reviewed by an admin before your profile goes live.
        </p>
        <Link href="/member/login" className="btn-outline" style={{ padding: '10px 24px', display: 'inline-flex' }}>
          Already a member? Log In
        </Link>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', background: 'var(--bg-card)', borderRadius: '24px', padding: '2.5rem', border: '1px solid var(--border)' }}>
        <form onSubmit={handleFormSubmit}>
          <div style={{ background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '0.9rem', color: 'var(--accent)' }}>
            <FaExclamationTriangle style={{ marginRight: '8px' }} />
            Applications are reviewed by an admin before your profile becomes visible.
          </div>

          <div className="form-group">
            <label className="form-label">Full Name *</label>
            <input
              required
              type="text"
              className="form-input"
              placeholder="e.g. John Doe"
              value={formData.name}
              onChange={(e) => updateFormField('name', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Registration Number (Unique ID) *</label>
            <input
              required
              type="text"
              className="form-input"
              placeholder="e.g. 22NIELIT101"
              value={formData.registrationNumber}
              onChange={(e) => updateFormField('registrationNumber', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email *</label>
            <input
              required
              type="email"
              className="form-input"
              placeholder="your.email@example.com"
              value={formData.email}
              onChange={(e) => updateFormField('email', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Set Password *</label>
            <div style={{ position: 'relative' }}>
              <input
                required
                type={showPassword ? 'text' : 'password'}
                minLength={8}
                className="form-input"
                placeholder="Minimum 8 chars (uppercase, lowercase, number/symbol)"
                value={formData.password}
                onChange={(e) => updateFormField('password', e.target.value)}
                style={{ paddingRight: '44px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  lineHeight: 1,
                }}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <small style={{ color: 'var(--text-dim)', fontSize: '0.78rem', display: 'block', marginTop: '4px' }}>
              Must be at least 8 characters with uppercase, lowercase, and a number or symbol.
            </small>
          </div>

          <div className="form-group">
            <label className="form-label">Profile Image URL (use <Link href="https://postimages.org/" target="_blank" style={{ textDecoration: 'underline', color: 'var(--accent)' }} rel="noreferrer">postimages.org</Link> to upload image and copy the direct link)</label>
            <input
              type="url"
              className="form-input"
              placeholder="https://..."
              value={formData.image}
              onChange={(e) => updateFormField('image', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Bio (max 500 chars)</label>
            <textarea
              className="form-input"
              placeholder="Tell us about yourself..."
              rows={3}
              value={formData.bio}
              onChange={(e) => updateFormField('bio', e.target.value.substring(0, 500))}
            ></textarea>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div className="form-group">
              <label className="form-label">GitHub URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://..."
                value={formData.github}
                onChange={(e) => updateFormField('github', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">LinkedIn URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://..."
                value={formData.linkedin}
                onChange={(e) => updateFormField('linkedin', e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '16px' }}
            disabled={formLoading}
          >
            {formLoading ? 'Submitting...' : 'Submit Application'}
          </button>
        </form>
      </div>
    </div>
  );
}
