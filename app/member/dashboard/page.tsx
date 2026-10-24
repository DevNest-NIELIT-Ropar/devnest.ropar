'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, query, where, getDocs, updateDoc, addDoc, doc, getDoc,
  limit, orderBy, onSnapshot
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import toast from 'react-hot-toast';
import {
  FaGithub, FaLinkedin, FaSignOutAlt, FaTrophy, FaCalendarAlt,
  FaProjectDiagram, FaEdit, FaSave, FaTimes, FaUser, FaLink,
  FaExternalLinkAlt, FaMapMarkerAlt, FaClock, FaHourglassHalf, FaCheckCircle,
  FaClipboardList, FaUsers, FaStar, FaMedal, FaChevronDown, FaChevronUp
} from 'react-icons/fa';

// ─── helpers ────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Avatar({ src, name, size = 80 }: { src?: string; name: string; size?: number }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const fallback = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100"><rect fill="%231e293b" width="100" height="100"/><text fill="%2300ff88" x="50" y="54" font-family="sans-serif" font-size="44" font-weight="bold" text-anchor="middle" alignment-baseline="middle">${initial}</text></svg>`;
  return (
    <img
      src={src || fallback}
      alt={name}
      onError={(e) => { (e.target as HTMLImageElement).src = fallback; }}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
    />
  );
}

// ─── main component ──────────────────────────────────────────────────────────
export default function MemberDashboardPage() {
  const router = useRouter();

  // auth / profile
  const [loading, setLoading] = useState(true);
  const [memberDocId, setMemberDocId] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [pendingRequest, setPendingRequest] = useState<any>(null);

  // live data
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [myProjects, setMyProjects] = useState<any[]>([]);

  // enriched registrations: each entry has the reg stub from member doc +
  // live event status + the registration doc score from Firestore
  const [enrichedRegs, setEnrichedRegs] = useState<any[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [expandedReg, setExpandedReg] = useState<string | null>(null);

  // edit mode
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', bio: '', image: '', github: '', linkedin: '',
  });

  // ── auth guard & profile fetch (live onSnapshot) ────────────────────────
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubRequests: (() => void) | null = null;
    let initialFormSet = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push('/member/login');
        return;
      }

      // ── ONE-TIME query to find the member doc ID ──
      const q = query(collection(db, 'members'), where('uid', '==', user.uid));
      const snap = await getDocs(q);

      if (snap.empty) {
        toast.error('No approved profile linked to this account. Contact an admin.');
        await signOut(auth);
        localStorage.removeItem('devnest_admin');
        router.push('/member/login');
        return;
      }

      const docId = snap.docs[0].id;
      setMemberDocId(docId);

      // ── LIVE listener on the member doc ──
      // This means any write to myRegistrations, points, etc. instantly
      // reflects here without requiring a full page reload.
      unsubProfile = onSnapshot(doc(db, 'members', docId), async (docSnap) => {
        if (!docSnap.exists()) {
          toast.error('Your member profile has been removed.');
          await signOut(auth);
          localStorage.removeItem('devnest_admin');
          router.push('/member/login');
          return;
        }
        const data: any = { id: docSnap.id, ...docSnap.data() };

        // Only pre-fill the edit form on the very first load
        if (!initialFormSet) {
          initialFormSet = true;
          setFormData({
            name: data.name || '',
            bio: data.bio || '',
            image: data.image || '',
            github: data.github || '',
            linkedin: data.linkedin || '',
          });

          // ── Monthly reset (run once on load) ──
          const now = new Date();
          const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
          if (data.lastResetMonth && data.lastResetMonth !== currentMonthKey) {
            try {
              await updateDoc(doc(db, 'members', docId), {
                currentMonthPoints: 0,
                lastResetMonth: currentMonthKey,
              });
            } catch (resetErr) {
              console.warn('Could not reset monthly points:', resetErr);
            }
          } else if (!data.lastResetMonth) {
            try {
              await updateDoc(doc(db, 'members', docId), {
                lastResetMonth: currentMonthKey,
                totalPoints: data.totalPoints ?? 0,
                currentMonthPoints: data.currentMonthPoints ?? 0,
              });
            } catch (_) { /* non-fatal */ }
          }
        }

        setProfile(data);
        setLoading(false);
      }, (err) => {
        console.error('Member profile snapshot error:', err);
        setLoading(false);
      });

      // ── Live listener for pending profile update requests ──
      const reqQuery = query(collection(db, 'profileUpdateRequests'), where('uid', '==', user.uid));
      unsubRequests = onSnapshot(reqQuery, (reqSnap) => {
        const activePending = reqSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .find((r: any) => r.status === 'pending');
        setPendingRequest(activePending || null);
      });
    });

    return () => {
      unsub();
      if (unsubProfile) unsubProfile();
      if (unsubRequests) unsubRequests();
    };
  }, [router]);

  // ── live: leaderboard ──────────────────────────────────────────────────
  // NOTE: reads memberProfiles (public by design), NOT members — Firestore rules
  // only let a member read their own members doc, so querying members here
  // throws permission-denied for non-admins. memberProfiles is keyed by the
  // same member doc id, so rank matching still works.
  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'memberProfiles'));
    const unsub = onSnapshot(q, (snap) => {
      const allMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Mirror the leaderboard page exactly:
      // 1. Only approved members count toward ranking
      // 2. Same 3-level tie-break: currentMonthPoints → totalPoints → name
      const approved = allMembers.filter((m: any) => m.status === 'approved');
      approved.sort((a: any, b: any) => {
        const pointsA = Number(a.currentMonthPoints) || 0;
        const pointsB = Number(b.currentMonthPoints) || 0;
        if (pointsB !== pointsA) return pointsB - pointsA;
        const totalA = Number(a.totalPoints) || 0;
        const totalB = Number(b.totalPoints) || 0;
        if (totalB !== totalA) return totalB - totalA;
        return (a.name || '').localeCompare(b.name || '');
      });
      setLeaderboard(approved);
    }, (err) => console.warn('Leaderboard snapshot error:', err));
    return () => unsub();
  }, [profile]);

  // ── live: upcoming events (next 3) ─────────────────────────────────────
  // NOTE: uses orderBy only (no compound where+orderBy) to avoid needing
  // a composite Firestore index. Filtering is done client-side.
  useEffect(() => {
    const q = query(
      collection(db, 'events'),
      orderBy('date', 'asc'),
      limit(10)
    );
    const unsub = onSnapshot(q,
      (snap) => {
        const all: any[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Client-side filter for upcoming/ongoing events
        const active = all
          .filter((e: any) => e.status === 'upcoming' || e.status === 'ongoing')
          .slice(0, 3);
        setUpcomingEvents(active);
      },
      (err) => console.warn('Events snapshot error:', err)
    );
    return () => unsub();
  }, []);

  // ── live: my submitted projects ────────────────────────────────────────
  // Uses profile.uid from state (avoids auth.currentUser race condition)
  useEffect(() => {
    if (!profile?.uid) return;
    const q = query(
      collection(db, 'projects'),
      where('submittedByUid', '==', profile.uid),
      orderBy('updatedAt', 'desc'),
      limit(6)
    );
    const unsub = onSnapshot(q,
      (snap) => {
      setMyProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [profile]);

  // ── live: enriched registrations ──────────────────────────────────────
  // Fetches registrations via server API (/api/member/registrations) which uses
  // Firebase Admin SDK. This bypasses client Firestore security rules, finds both
  // solo and team entries by UID or registration number, and auto-heals the member doc.
  const loadEnrichedRegs = useCallback(async (regs: any[], uid: string, regNumber?: string) => {
    setRegsLoading(true);
    try {
      // 1. Primary: Call server route for 100% reliable results across all events
      if (uid || regNumber) {
        try {
          const res = await fetch(`/api/member/registrations?uid=${encodeURIComponent(uid || '')}&regNumber=${encodeURIComponent(regNumber || '')}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(data.registrations)) {
            setEnrichedRegs(data.registrations);
            return;
          }
        } catch (apiErr) {
          console.warn('Server registrations fetch failed, falling back to client-side:', apiErr);
        }
      }

      // 2. Fallback: Parse profile.myRegistrations client-side if server fetch fails
      const stubList: any[] = regs ? [...regs] : [];
      if (stubList.length === 0) {
        setEnrichedRegs([]);
        return;
      }

      const enriched = await Promise.all(
        [...stubList].reverse().map(async (reg: any) => {
          try {
            let eventStatus = 'upcoming';
            let eventDate: string | null = null;
            let eventVenue: string | null = null;
            if (reg.eventId) {
              const evDoc = await getDoc(doc(db, 'events', reg.eventId));
              if (evDoc.exists()) {
                const evData = evDoc.data();
                eventStatus = evData.status || 'upcoming';
                eventDate = evData.date || null;
                eventVenue = evData.venue || null;
              }
            }

            let score: number | null = null;
            let regStatus: string | null = null;
            let scoredAt: string | null = null;
            if (reg.eventId && reg.regId) {
              try {
                const regDoc = await getDoc(doc(db, 'events', reg.eventId, 'registrations', reg.regId));
                if (regDoc.exists()) {
                  const rd = regDoc.data();
                  score = typeof rd.score === 'number' ? rd.score : null;
                  regStatus = rd.status || null;
                  scoredAt = rd.scoredAt || null;
                }
              } catch (e) {
                console.warn('Could not read registration doc for score:', reg.regId, e);
              }
            }

            return { ...reg, eventStatus, eventDate, eventVenue, score, regStatus, scoredAt };
          } catch (_) {
            return { ...reg, eventStatus: 'upcoming', score: null };
          }
        })
      );
      setEnrichedRegs(enriched);
    } finally {
      setRegsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile) return;
    loadEnrichedRegs(profile.myRegistrations || [], profile.uid, profile.registrationNumber);
  }, [profile, loadEnrichedRegs]);

  // ── derived stats ──────────────────────────────────────────────────────
  const myLeaderboardEntry = leaderboard.find(e => e.id === memberDocId || (e.registrationNumber && e.registrationNumber === profile?.registrationNumber) || e.name === profile?.name);
  const myRank = myLeaderboardEntry
    ? leaderboard.findIndex(e => e.id === memberDocId || (e.registrationNumber && e.registrationNumber === profile?.registrationNumber) || e.name === profile?.name) + 1
    : null;

  // ── save profile (submit request for admin approval) ──────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberDocId || !profile) return;
    if (formData.bio.length > 500) { toast.error('Bio must be under 500 characters'); return; }

    setSaving(true);
    try {
      const requestPayload = {
        uid: auth.currentUser?.uid || profile.uid,
        memberDocId,
        memberName: formData.name.trim(),
        memberEmail: profile.email || auth.currentUser?.email || '',
        registrationNumber: profile.registrationNumber || '',
        requestedData: {
          name: formData.name.trim(),
          bio: formData.bio.trim(),
          image: formData.image.trim(),
          github: formData.github.trim(),
          linkedin: formData.linkedin.trim(),
        },
        currentData: {
          name: profile.name || '',
          bio: profile.bio || '',
          image: profile.image || '',
          github: profile.github || '',
          linkedin: profile.linkedin || '',
        },
        status: 'pending',
        createdAt: pendingRequest?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (pendingRequest && pendingRequest.id) {
        await updateDoc(doc(db, 'profileUpdateRequests', pendingRequest.id), requestPayload);
      } else {
        await addDoc(collection(db, 'profileUpdateRequests'), requestPayload);
      }

      toast.success('Profile update requested! Changes will be applied after admin approval.');
      setEditing(false);
    } catch (err) {
      console.error('Failed to submit profile update request:', err);
      toast.error('Failed to submit update request.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/member/login');
  };

  // ─── loading skeleton ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="skeleton" style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto 16px' }} />
          <div className="skeleton" style={{ width: 200, height: 20, borderRadius: 8, margin: '0 auto 10px' }} />
          <div className="skeleton" style={{ width: 140, height: 14, borderRadius: 8, margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  if (!memberDocId || !profile) {
    return (
      <div className="container" style={{ padding: '6rem 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🔒</div>
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>No Profile Found</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          Your account isn't linked to a member profile yet. Please contact an admin.
        </p>
        <button className="btn-outline" onClick={handleLogout}>Sign Out</button>
      </div>
    );
  }

  // ─── main render ────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* ── Top Header Bar ── */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(10,15,30,0.85)',
        backdropFilter: 'blur(12px)',
        padding: '0 20px',
        position: 'sticky',
        top: 72,
        zIndex: 40,
      }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar src={profile.image} name={profile.name} size={32} />
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {profile.name}
            </span>
            <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Member</span>
          </div>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', transition: 'color 0.2s' }}
          >
            <FaSignOutAlt /> Sign Out
          </button>
        </div>
      </div>

      <div className="container" style={{ padding: '2.5rem 20px 5rem' }}>

        {/* ── Greeting + stat pills ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{ marginBottom: '2.5rem' }}
        >
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, marginBottom: 6 }}>
            {getGreeting()}, <span className="gradient-text">{profile.name.split(' ')[0]}</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1.5rem' }}>
            Welcome to your DevNest member dashboard. Here's what's happening.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Monthly Rank pill */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '12px 20px', minWidth: 130, textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 4 }}>LEADERBOARD RANK</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--gold)' }}>
                {myRank ? `#${myRank}` : '—'}
              </div>
            </div>

            {/* Total Points pill */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '12px 20px', minWidth: 130, textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 4 }}>TOTAL POINTS</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--accent)' }}>
                {(profile.totalPoints ?? 0).toLocaleString()}
              </div>
            </div>

            {/* Current Month Points pill */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid rgba(0,204,255,0.3)', borderRadius: 12,
              padding: '12px 20px', minWidth: 130, textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 4 }}>THIS MONTH</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--info)' }}>
                {(profile.currentMonthPoints ?? 0).toLocaleString()}
              </div>
            </div>

            {/* Projects pill */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '12px 20px', minWidth: 130, textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 4 }}>MY PROJECTS</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--info)' }}>
                {myProjects.length}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Main Grid: left (events + projects) | right (profile card) ── */}
        <div data-dashboard-grid style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '2rem', alignItems: 'start' }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            {/* Upcoming Events */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}
            >
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FaCalendarAlt style={{ color: 'var(--accent)', fontSize: '1rem' }} />
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem' }}>Upcoming Events</span>
                </div>
                <Link href="/events" style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  View all <FaExternalLinkAlt size={10} />
                </Link>
              </div>

              {upcomingEvents.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No upcoming events scheduled.
                </div>
              ) : (
                upcomingEvents.map((event, i) => (
                  <div
                    key={event.id}
                    style={{
                      padding: '16px 24px',
                      borderBottom: i < upcomingEvents.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex', alignItems: 'center', gap: 16,
                      transition: 'background 0.2s',
                    }}
                  >
                    {/* color accent dot */}
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: event.status === 'ongoing' ? 'var(--accent)' : 'var(--info)',
                      boxShadow: event.status === 'ongoing' ? '0 0 8px var(--accent-glow-strong)' : 'none',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{event.title}</div>
                      <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <FaCalendarAlt size={10} /> {event.date ? new Date(event.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'TBA'}
                        </span>
                        {event.venue && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <FaMapMarkerAlt size={10} /> {event.venue}
                          </span>
                        )}
                        <span className={event.status === 'ongoing' ? 'badge badge-green' : 'badge badge-blue'} style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
                          {event.type || event.status}
                        </span>
                      </div>
                    </div>
                    <Link href="/events" className="btn-outline" style={{ padding: '6px 16px', fontSize: '0.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Details
                    </Link>
                  </div>
                ))
              )}
            </motion.section>

            {/* My Event Registrations — live enriched */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}
            >
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FaClipboardList style={{ color: 'var(--accent)', fontSize: '1rem' }} />
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem' }}>My Event Registrations</span>
                  {enrichedRegs.length > 0 && (
                    <span className="badge badge-blue" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>{enrichedRegs.length}</span>
                  )}
                </div>
                <Link href="/events" style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Browse events <FaExternalLinkAlt size={10} />
                </Link>
              </div>

              {regsLoading ? (
                <div style={{ padding: '32px 24px' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
                      <div className="skeleton" style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div className="skeleton" style={{ width: '60%', height: 14, marginBottom: 8 }} />
                        <div className="skeleton" style={{ width: '40%', height: 10 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : enrichedRegs.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <FaCalendarAlt style={{ fontSize: '2.5rem', color: 'var(--border-light)', marginBottom: 12 }} />
                  <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>You haven&apos;t registered for any events yet.</p>
                  <Link href="/events" className="btn-primary" style={{ padding: '10px 24px', fontSize: '0.85rem' }}>
                    Browse Events
                  </Link>
                </div>
              ) : (
                enrichedRegs.map((reg: any, i: number) => {
                  const isCompleted = reg.eventStatus === 'completed' || reg.eventStatus === 'past';
                  const isLive = reg.eventStatus === 'live' || reg.eventStatus === 'ongoing';
                  const isExpanded = expandedReg === (reg.regId || String(i));

                  const statusColor = isCompleted ? 'var(--text-dim)' : isLive ? 'var(--accent)' : 'var(--info)';
                  const statusGlow = isCompleted ? 'none' : isLive ? '0 0 8px var(--accent-glow-strong)' : 'none';
                  const statusLabel = isCompleted ? 'Completed' : isLive ? 'Live' : 'Upcoming';
                  const statusBadgeClass = isCompleted ? 'badge-yellow' : isLive ? 'badge-green' : 'badge-blue';

                  return (
                    <div key={reg.regId || i} style={{ borderBottom: i < enrichedRegs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      {/* Main row */}
                      <div
                        onClick={() => {
                          if (isCompleted) setExpandedReg(isExpanded ? null : (reg.regId || String(i)));
                        }}
                        style={{
                          padding: '16px 24px',
                          display: 'flex', alignItems: 'center', gap: 16,
                          cursor: isCompleted ? 'pointer' : 'default',
                          transition: 'background 0.2s',
                          background: isExpanded ? 'rgba(0,255,136,0.04)' : 'transparent',
                        }}
                        onMouseEnter={e => { if (isCompleted) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isExpanded ? 'rgba(0,255,136,0.04)' : 'transparent'; }}
                      >
                        {/* Status dot */}
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                          background: statusColor, boxShadow: statusGlow,
                        }} />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                              {reg.eventTitle || 'Event'}
                            </span>
                            <span className={`badge ${statusBadgeClass}`} style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className="badge badge-blue" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>
                              {reg.type || 'Solo'}
                            </span>
                            {reg.type === 'Team' && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <FaUsers size={9} /> {reg.role === 'leader' ? 'Team Leader' : 'Member'}{reg.teamName ? ` · ${reg.teamName}` : ''}
                              </span>
                            )}
                            {reg.eventDate && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <FaCalendarAlt size={9} />
                                {new Date(reg.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            )}
                            {/* Inline score pill for completed events */}
                            {isCompleted && reg.score !== null && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: 'rgba(255,215,0,0.12)', color: 'var(--gold)',
                                borderRadius: 20, padding: '2px 10px', fontFamily: 'var(--font-heading)',
                                fontWeight: 700, fontSize: '0.72rem', border: '1px solid rgba(255,215,0,0.25)'
                              }}>
                                <FaStar size={9} /> {reg.score} pts
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          {isCompleted ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedReg(isExpanded ? null : (reg.regId || String(i)));
                              }}
                              className="btn-outline"
                              style={{
                                padding: '6px 14px',
                                fontSize: '0.74rem',
                                whiteSpace: 'nowrap',
                                borderColor: isExpanded ? 'var(--accent)' : 'rgba(255,215,0,0.3)',
                                color: isExpanded ? 'var(--accent)' : 'var(--gold)',
                                background: isExpanded ? 'rgba(0,255,136,0.06)' : 'rgba(255,215,0,0.05)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                cursor: 'pointer'
                              }}
                            >
                              <span>{isExpanded ? 'Hide Points' : 'View Points'}</span>
                              {isExpanded ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
                            </button>
                          ) : (
                            <Link href="/events" className="btn-outline" style={{ padding: '5px 14px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                              View Event
                            </Link>
                          )}
                        </div>
                      </div>

                      {/* Expandable result panel — only for completed events */}
                      <AnimatePresence>
                        {isCompleted && isExpanded && (
                          <motion.div
                            key="detail"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                            style={{ overflow: 'hidden' }}
                          >
                            <div style={{
                              margin: '0 24px 16px',
                              background: 'rgba(0,0,0,0.25)',
                              border: '1px solid var(--border)',
                              borderRadius: 14,
                              padding: '18px 20px',
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 14 }}>EVENT RESULTS</div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
                                {/* Score */}
                                <div style={{
                                  background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.2)',
                                  borderRadius: 10, padding: '12px 14px', textAlign: 'center'
                                }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 6 }}>SCORE</div>
                                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-heading)' }}>
                                    {reg.score !== null ? reg.score : '—'}
                                  </div>
                                  {reg.score !== null && <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>out of 100</div>}
                                </div>

                                {/* Points awarded */}
                                <div style={{
                                  background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.15)',
                                  borderRadius: 10, padding: '12px 14px', textAlign: 'center'
                                }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 6 }}>POINTS EARNED</div>
                                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-heading)' }}>
                                    {reg.score !== null ? `+${reg.score}` : '—'}
                                  </div>
                                  {reg.score !== null && <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>XP added to total</div>}
                                </div>

                                {/* Participation badge */}
                                <div style={{
                                  background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                                  borderRadius: 10, padding: '12px 14px', textAlign: 'center'
                                }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-heading)', letterSpacing: 1, marginBottom: 6 }}>PARTICIPATION</div>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--info)', fontFamily: 'var(--font-heading)' }}>
                                    <FaCheckCircle style={{ marginRight: 4 }} />
                                    {reg.regStatus === 'approved' ? 'Verified' : 'Participated'}
                                  </div>
                                </div>
                              </div>

                              {reg.score === null && (
                                <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, fontSize: '0.8rem', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <FaHourglassHalf />
                                  Points haven&apos;t been assigned by the admin yet. Check back later.
                                </div>
                              )}

                              {reg.scoredAt && (
                                <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <FaClock size={9} /> Scored on {new Date(reg.scoredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </div>
                              )}

                              <div style={{ marginTop: 14 }}>
                                <Link href="/events" className="btn-outline" style={{ padding: '6px 16px', fontSize: '0.75rem' }}>
                                  <FaExternalLinkAlt size={10} /> View Event
                                </Link>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </motion.section>

            {/* My Projects */}
            {(() => {
              const verifiedProjects = myProjects.filter(p => p.status === 'approved' || (!p.status && !p.submittedByUid));
              const pendingProjects = myProjects.filter(p => p.status === 'pending');
              const rejectedProjects = myProjects.filter(p => p.status === 'rejected');

              return (
                <motion.section
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}
                >
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <FaProjectDiagram style={{ color: 'var(--info)', fontSize: '1rem' }} />
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem' }}>
                        My Verified Projects {verifiedProjects.length > 0 && `(${verifiedProjects.length})`}
                      </span>
                    </div>
                    <Link href="/projects" style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      Submit new <FaExternalLinkAlt size={10} />
                    </Link>
                  </div>

                  {pendingProjects.length > 0 && (
                    <div style={{
                      padding: '12px 20px',
                      background: 'rgba(250, 204, 21, 0.08)',
                      borderBottom: '1px solid rgba(250, 204, 21, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      fontSize: '0.82rem',
                      color: '#facc15'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FaHourglassHalf />
                        <span>
                          <strong>{pendingProjects.length} {pendingProjects.length === 1 ? 'project' : 'projects'} under review:</strong> &ldquo;{pendingProjects.map(p => p.title).join(', ')}&rdquo; — will be visible here and on the public Projects page once verified by an Admin.
                        </span>
                      </div>
                      <span className="badge badge-yellow" style={{ fontSize: '0.7rem', flexShrink: 0 }}>Pending Admin Verification</span>
                    </div>
                  )}

                  {rejectedProjects.length > 0 && (
                    <div style={{
                      padding: '12px 20px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      fontSize: '0.82rem',
                      color: 'var(--danger)'
                    }}>
                      {rejectedProjects.map((rp) => (
                        <div key={rp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div>
                            <strong>✕ &ldquo;{rp.title}&rdquo; was not approved:</strong> {rp.rejectionReason || 'Did not meet submission guidelines.'}
                          </div>
                          <Link href="/projects" style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: '0.75rem', flexShrink: 0 }}>
                            Edit & Resubmit
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}

                  {verifiedProjects.length === 0 ? (
                    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                      <FaProjectDiagram style={{ fontSize: '2.5rem', color: 'var(--border-light)', marginBottom: 12 }} />
                      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                        {pendingProjects.length > 0
                          ? 'Your submitted projects are currently awaiting admin verification.'
                          : "You haven't submitted any projects yet."}
                      </p>
                      <Link href="/projects" className="btn-primary" style={{ padding: '10px 24px', fontSize: '0.85rem' }}>
                        {pendingProjects.length > 0 ? 'Submit Another Project' : 'Submit Your First Project'}
                      </Link>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'var(--border)' }}>
                      {verifiedProjects.map((proj) => (
                        <div key={proj.id} style={{ background: 'var(--bg-card)', padding: '20px', transition: 'background 0.2s' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <span>{proj.title}</span>
                            <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>Verified</span>
                          </div>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 12, lineHeight: 1.5,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {proj.description}
                          </p>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                            {(proj.techStack || []).slice(0, 3).map((t: string) => (
                              <span key={t} className="badge badge-blue" style={{ fontSize: '0.65rem' }}>{t}</span>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 12 }}>
                            {proj.githubLink && (
                              <a href={proj.githubLink} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: '0.8rem', transition: 'color 0.2s' }}>
                                <FaGithub /> GitHub
                              </a>
                            )}
                            {proj.liveLink && (
                              <a href={proj.liveLink} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: '0.8rem', transition: 'opacity 0.2s' }}>
                                <FaLink /> Live
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.section>
              );
            })()}

            {/* Leaderboard snippet */}
            {leaderboard.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}
              >
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FaTrophy style={{ color: 'var(--gold)', fontSize: '1rem' }} />
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem' }}>Leaderboard Preview</span>
                  </div>
                  <Link href="/leaderboard" style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Full board <FaExternalLinkAlt size={10} />
                  </Link>
                </div>
                <div>
                  {leaderboard.slice(0, 5).map((coder, i) => {
                    const rankColors = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];
                    const isMe = coder.name === profile?.name;
                    return (
                      <div key={coder.id} style={{
                        padding: '14px 24px',
                        display: 'flex', alignItems: 'center', gap: 14,
                        borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                        background: isMe ? 'var(--accent-glow)' : 'transparent',
                        transition: 'background 0.2s'
                      }}>
                        <span style={{
                          width: 28, textAlign: 'center', fontFamily: 'var(--font-heading)',
                          fontWeight: 800, color: rankColors[i] || 'var(--text-dim)', flexShrink: 0
                        }}>
                          {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}
                        </span>
                        <Avatar src={coder.image} name={coder.name} size={32} />
                        <span style={{ flex: 1, fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--accent)' : 'var(--text-primary)' }}>
                          {coder.name} {isMe && <span style={{ fontSize: '0.75rem' }}>(you)</span>}
                        </span>
                        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--accent)', fontSize: '0.95rem' }}>
                          {(coder.currentMonthPoints ?? 0).toLocaleString()} pts
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.section>
            )}
          </div>

          {/* ── RIGHT COLUMN: Profile Card ── */}
          <motion.div
            data-profile-col
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            style={{ position: 'sticky', top: 145, display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            {/* Profile Card */}
            <div style={{
              background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)',
              overflow: 'hidden'
            }}>
              {/* Top banner */}
              <div style={{
                height: 70,
                background: 'linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,204,255,0.1))',
                borderBottom: '1px solid var(--border)',
              }} />

              <div style={{ padding: '0 20px 20px', marginTop: -36 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%',
                  border: '3px solid var(--bg-card)',
                  overflow: 'hidden', marginBottom: 10,
                  boxShadow: '0 0 0 2px var(--accent-glow)',
                }}>
                  <Avatar src={profile.image} name={profile.name} size={72} />
                </div>

                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {profile.name}
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    {profile.email || auth.currentUser?.email}
                  </span>
                  {profile.registrationNumber && (
                    <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600 }}>
                      Reg No: {profile.registrationNumber}
                    </span>
                  )}
                </div>

                {/* Pending Profile Update Banner */}
                {pendingRequest && pendingRequest.status === 'pending' && (
                  <div style={{
                    background: 'rgba(250, 204, 21, 0.12)',
                    border: '1px solid var(--warning, #facc15)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    marginBottom: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.8rem',
                    color: '#facc15'
                  }}>
                    <FaHourglassHalf />
                    <div>
                      <div style={{ fontWeight: 700 }}>Profile Update Pending</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Under review by admin</div>
                    </div>
                  </div>
                )}

                {profile.bio && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.55, marginBottom: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    {profile.bio}
                  </p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {myRank && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Leaderboard Rank</span>
                      <span style={{ fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-heading)' }}>#{myRank}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total Points</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-heading)' }}>
                      {(profile.totalPoints ?? 0).toLocaleString()} XP
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>This Month</span>
                    <span style={{ fontWeight: 700, color: 'var(--info)', fontFamily: 'var(--font-heading)' }}>
                      {(profile.currentMonthPoints ?? 0).toLocaleString()} XP
                    </span>
                  </div>
                  {myLeaderboardEntry?.codeforcesRating && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Codeforces Rating</span>
                      <span style={{ fontWeight: 700, color: 'var(--info)', fontFamily: 'var(--font-heading)' }}>
                        {myLeaderboardEntry.codeforcesRating}
                      </span>
                    </div>
                  )}
                  {myLeaderboardEntry?.leetcodeProblems && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>LeetCode Solved</span>
                      <span style={{ fontWeight: 700, color: 'var(--warning)', fontFamily: 'var(--font-heading)' }}>
                        {myLeaderboardEntry.leetcodeProblems}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  {profile.github && (
                    <a href={profile.github} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-muted)', transition: 'color 0.2s', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <FaGithub /> GitHub
                    </a>
                  )}
                  {profile.linkedin && (
                    <a href={profile.linkedin} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--info)', transition: 'color 0.2s', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <FaLinkedin /> LinkedIn
                    </a>
                  )}
                </div>

                <Link href="/leaderboard" className="btn-outline" style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '0.82rem' }}>
                  <FaTrophy /> View Leaderboard
                </Link>
              </div>
            </div>

            {/* Edit Profile Button */}
            <button
              onClick={() => setEditing(true)}
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '0.88rem' }}
            >
              <FaEdit /> Edit Profile
            </button>
          </motion.div>
        </div>
      </div>

      {/* ── Edit Profile Modal ── */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 540 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                <FaUser style={{ color: 'var(--accent)', marginRight: 8 }} />
                Edit Profile
              </h2>
              <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>
                <FaTimes />
              </button>
            </div>

            {/* Admin verification note */}
            <div style={{
              background: pendingRequest && pendingRequest.status === 'pending' ? 'rgba(250, 204, 21, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              border: pendingRequest && pendingRequest.status === 'pending' ? '1px solid var(--warning, #facc15)' : '1px solid var(--info)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 18,
              fontSize: '0.83rem',
              color: pendingRequest && pendingRequest.status === 'pending' ? '#facc15' : 'var(--info)'
            }}>
              {pendingRequest && pendingRequest.status === 'pending'
                ? '⚠️ You have a pending update request. Submitting again will update your requested changes for admin verification.'
                : 'ℹ️ For security and verification, profile edits must be approved by an admin before being applied.'}
            </div>

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input required type="text" className="form-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>

              {profile.registrationNumber && (
                <div className="form-group">
                  <label className="form-label">Registration Number (Unique Member ID)</label>
                  <input type="text" className="form-input" disabled
                    value={profile.registrationNumber}
                    style={{ opacity: 0.7, cursor: 'not-allowed', background: 'var(--bg-secondary)' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
                    Registration number is permanently assigned and cannot be modified.
                  </span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Profile Image URL</label>
                <input type="url" className="form-input" placeholder="https://..."
                  value={formData.image}
                  onChange={(e) => setFormData({ ...formData, image: e.target.value })} />
                {formData.image && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar src={formData.image} name={formData.name} size={44} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Preview</span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Bio ({formData.bio.length}/500)</label>
                <textarea className="form-input" rows={3}
                  placeholder="Tell the club about yourself..."
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value.substring(0, 500) })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label"><FaGithub style={{ marginRight: 4 }} />GitHub URL</label>
                  <input type="url" className="form-input" placeholder="https://github.com/..."
                    value={formData.github}
                    onChange={(e) => setFormData({ ...formData, github: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label"><FaLinkedin style={{ marginRight: 4 }} />LinkedIn URL</label>
                  <input type="url" className="form-input" placeholder="https://linkedin.com/in/..."
                    value={formData.linkedin}
                    onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" className="btn-outline" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1.5, justifyContent: 'center' }}
                  disabled={saving}>
                  <FaSave /> {saving ? 'Submitting Request...' : 'Request Update'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ── Responsive: collapse right column below 900px ── */}
      <style>{`
        @media (max-width: 900px) {
          [data-dashboard-grid] {
            grid-template-columns: 1fr !important;
          }
          [data-profile-col] {
            position: static !important;
            order: -1;
          }
        }
      `}</style>
    </div>
  );
}