'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  FaCalendarAlt, FaMapMarkerAlt, FaClock, FaTag,
  FaRegFileAlt, FaExclamationTriangle, FaSync, FaUsers, FaUser, FaLock
} from 'react-icons/fa';
import { collection, onSnapshot, query, orderBy, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { registerForEvent } from '@/lib/services';
import EventCard from '@/components/EventCard';
import Modal from '@/components/Modal';
import { CardSkeleton } from '@/components/Skeleton';
import toast from 'react-hot-toast';

export default function EventsPage() {
  const router = useRouter();
  // Genuine data only: start empty, show skeletons until Firestore loads
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'live' | 'completed'>('all');
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [completedEventRegs, setCompletedEventRegs] = useState<any[]>([]);
  const [completedRegsLoading, setCompletedRegsLoading] = useState(false);

  // Auth & Member Profile state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [memberProfile, setMemberProfile] = useState<any>(null);

  // Registration Modal State
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [submittingReg, setSubmittingReg] = useState(false);

  // Solo Form State
  const [soloForm, setSoloForm] = useState({
    name: '',
    college: '',
    branch: '',
    year: '1st Year',
    semester: '1st',
    regNumber: ''
  });

  // Team Form State
  const [teamForm, setTeamForm] = useState({
    teamName: '',
    teamLeader: '',
    college: '',
    memberCount: 2,
    members: [
      { name: '', regNumber: '', branch: '', year: '1st Year', semester: '1st' },
      { name: '', regNumber: '', branch: '', year: '1st Year', semester: '1st' }
    ]
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const q = query(collection(db, 'members'), where('uid', '==', user.uid));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const data = snap.docs[0].data();
            setMemberProfile({ id: snap.docs[0].id, ...data });
            setSoloForm(prev => ({
              ...prev,
              name: data.name || user.displayName || '',
              regNumber: data.registrationNumber || ''
            }));
            setTeamForm(prev => ({
              ...prev,
              teamLeader: data.name || user.displayName || '',
            }));
          }
        } catch (err) {
          console.error('Failed to load member profile:', err);
        }
      } else {
        setMemberProfile(null);
      }
    });

    const unsubscribe = onSnapshot(collection(db, 'events'),
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        items.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setEvents(items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Firestore error:", err);
        setError("Failed to load events. Please check your connection.");
        setLoading(false);
      }
    );

    return () => {
      unsubAuth();
      unsubscribe();
    };
  }, []);

  const filteredEvents = events.filter(event => {
    const s = (event.status || '').toLowerCase().trim();
    if (filter === 'all') return true;
    if (filter === 'live') return s === 'live' || s === 'ongoing';
    if (filter === 'completed') return s === 'completed' || s === 'past';
    if (filter === 'upcoming') {
      return s === 'upcoming' || (!s && (!event.date || new Date(event.date).getTime() >= Date.now()));
    }
    return s === filter;
  });

  // Load registrations & results when a completed event is opened
  const handleSelectEvent = async (event: any) => {
    setSelectedEvent(event);
    if (event.status === 'completed' || event.status === 'past') {
      setCompletedRegsLoading(true);
      setCompletedEventRegs([]);
      try {
        const res = await fetch(`/api/events/results?eventId=${event.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.results) {
            setSelectedEvent((prev: any) => ({ ...prev, openResults: data.results, results: data.results }));
          }
          if (Array.isArray(data.topPerformers) && data.topPerformers.length > 0) {
            setCompletedEventRegs(data.topPerformers);
          }
        } else {
          const snap = await getDocs(collection(db, 'events', event.id, 'registrations'));
          const regs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setCompletedEventRegs(regs);
        }
      } catch (err) {
        console.warn('Could not load event results:', err);
      } finally {
        setCompletedRegsLoading(false);
      }
    } else {
      setCompletedEventRegs([]);
    }
  };

  // Handle "Register Now" click
  const handleInitiateRegistration = async () => {
    if (!selectedEvent) return;

    if (selectedEvent.mode === 'Intra-College' && !currentUser) {
      toast.error('Please log in with your member account to register for Intra-College events.');
      router.push('/member/login?redirect=/events');
      return;
    }

    // Check if logged-in user has already registered for this event
    if (currentUser) {
      try {
        const regQuery = query(
          collection(db, 'events', selectedEvent.id, 'registrations'),
          where('submittedByUid', '==', currentUser.uid)
        );
        const regSnap = await getDocs(regQuery);
        if (!regSnap.empty) {
          toast.error('You have already registered for this event. Multiple registrations from a single account are not allowed.');
          return;
        }
      } catch (err) {
        console.error('Error checking duplicate registration:', err);
      }
    }

    // Reset forms & initialize with member profile if available
    const initialName = memberProfile?.name || currentUser?.displayName || '';
    const initialRegNo = memberProfile?.registrationNumber || '';

    setSoloForm({
      name: initialName,
      college: selectedEvent.mode === 'Intra-College' ? 'NIELIT' : '',
      branch: '',
      year: '1st Year',
      semester: '1st',
      regNumber: initialRegNo
    });

    const initialCount = 2;
    const initialMembers = Array.from({ length: initialCount }, (_, idx) => ({
      name: idx === 0 ? initialName : '',
      regNumber: idx === 0 ? initialRegNo : '',
      branch: '',
      year: '1st Year',
      semester: '1st'
    }));

    setTeamForm({
      teamName: '',
      teamLeader: initialName,
      college: selectedEvent.mode === 'Intra-College' ? 'NIELIT' : '',
      memberCount: initialCount,
      members: initialMembers
    });

    setIsRegModalOpen(true);
  };

  const handleMemberCountChange = (count: number) => {
    const currentMembers = [...teamForm.members];
    if (count > currentMembers.length) {
      for (let i = currentMembers.length; i < count; i++) {
        currentMembers.push({ name: '', regNumber: '', branch: '', year: '1st Year', semester: '1st' });
      }
    } else {
      currentMembers.splice(count);
    }
    setTeamForm({ ...teamForm, memberCount: count, members: currentMembers });
  };

  const handleMemberFieldChange = (index: number, field: string, value: string) => {
    const updated = [...teamForm.members];
    updated[index] = { ...updated[index], [field]: value };
    setTeamForm({ ...teamForm, members: updated });
  };

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent) return;

    const isSolo = selectedEvent.type === 'Solo';
    const isOpenMode = selectedEvent.mode === 'Open';

    // Duplicate check safeguard before submission
    if (currentUser) {
      try {
        const regQuery = query(
          collection(db, 'events', selectedEvent.id, 'registrations'),
          where('submittedByUid', '==', currentUser.uid)
        );
        const regSnap = await getDocs(regQuery);
        if (!regSnap.empty) {
          toast.error('You have already registered for this event.');
          return;
        }
      } catch (err) {
        console.error('Error verifying registration duplicate:', err);
      }
    }

    // Alphanumeric validation regex
    const alphaNumRegex = /^[A-Za-z0-9_-]+$/;

    if (isSolo) {
      if (!alphaNumRegex.test(soloForm.regNumber.trim())) {
        toast.error('Registration Number must be alphanumeric (letters, numbers, hyphens only)');
        return;
      }
    } else {
      for (let i = 0; i < teamForm.members.length; i++) {
        const m = teamForm.members[i];
        if (!alphaNumRegex.test(m.regNumber.trim())) {
          toast.error(`Member ${i + 1} registration number must be alphanumeric`);
          return;
        }
      }
    }

    // Intra-college TEAM registration goes through the server route: it verifies
    // every member's registration number ("Member not existed" otherwise),
    // creates the registration, and mirrors it into EACH team member's
    // myRegistrations so it shows on every member's dashboard.
    // (Open team events keep the client flow below — guests have no accounts.)
    if (!isSolo && !isOpenMode) {
      setSubmittingReg(true);
      try {
        const res = await fetch('/api/events/register-team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: selectedEvent.id,
            submitterUid: currentUser?.uid || null,
            teamName: teamForm.teamName,
            teamLeader: teamForm.teamLeader,
            college: teamForm.college,
            members: teamForm.members,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || 'Registration failed. Please try again.');
        } else {
          toast.success('Team registered successfully! It now shows on every team member’s dashboard.');
          setIsRegModalOpen(false);
          setSelectedEvent(null);
        }
      } catch (err) {
        console.error('Team registration failed:', err);
        toast.error('Registration failed. Please try again.');
      } finally {
        setSubmittingReg(false);
      }
      return;
    }

    setSubmittingReg(true);

    const payload = isSolo
      ? {
          type: 'Solo',
          mode: selectedEvent.mode || 'Intra-College',
          status: isOpenMode ? 'pending' : 'approved',
          submittedByUid: currentUser?.uid || null,
          name: soloForm.name.trim(),
          college: isOpenMode ? soloForm.college.trim() : 'NIELIT',
          branch: soloForm.branch.trim(),
          year: soloForm.year,
          semester: soloForm.semester,
          regNumber: soloForm.regNumber.trim().toUpperCase(),
          eventTitle: selectedEvent.title
        }
      : {
          type: 'Team',
          mode: selectedEvent.mode || 'Intra-College',
          status: isOpenMode ? 'pending' : 'approved',
          submittedByUid: currentUser?.uid || null,
          teamName: teamForm.teamName.trim(),
          teamLeader: teamForm.teamLeader.trim(),
          college: isOpenMode ? teamForm.college.trim() : 'NIELIT',
          memberCount: teamForm.memberCount,
          members: teamForm.members.map(m => ({
            name: m.name.trim(),
            regNumber: m.regNumber.trim().toUpperCase(),
            branch: m.branch.trim(),
            year: m.year,
            semester: m.semester
          })),
          eventTitle: selectedEvent.title
        };

    try {
      const res = await fetch('/api/events/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          submitterUid: currentUser?.uid || null,
          memberDocId: memberProfile?.id || null,
          payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Registration failed. Please try again.');
      } else {
        if (isOpenMode) {
          toast.success('Registration submitted! It is pending admin verification.');
        } else {
          toast.success('Registration successful! You are registered for this event.');
        }
        setIsRegModalOpen(false);
        setSelectedEvent(null);
      }
    } catch (err: any) {
      console.error('Registration failed:', err);
      toast.error('Registration failed. Please try again.');
    } finally {
      setSubmittingReg(false);
    }
  };

  return (
    <div className="container page-enter page-enter-active" style={{ padding: '4rem 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 800, marginBottom: '1rem' }}>
          Club <span className="gradient-text">Events</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '700px', margin: '0 auto 2rem auto' }}>
          Join us for hackathons, workshops, coding contests, and tech talks. There's always something happening at DevNest.
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', padding: '20px', borderRadius: '12px', textAlign: 'center', marginBottom: '3rem', color: 'var(--danger)' }}>
          <FaExclamationTriangle style={{ fontSize: '2rem', marginBottom: '12px' }} />
          <p style={{ marginBottom: '16px' }}>{error}</p>
          <button className="btn-outline" onClick={() => window.location.reload()} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <FaSync /> Retry
          </button>
        </div>
      )}

      {!error && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '3rem', flexWrap: 'wrap' }}>
            {(['all', 'upcoming', 'live', 'completed'] as const).map((gFilter) => (
              <button
                key={gFilter}
                onClick={() => setFilter(gFilter)}
                style={{
                  padding: '10px 24px',
                  borderRadius: '30px',
                  border: filter === gFilter ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: filter === gFilter ? 'var(--accent-glow)' : 'transparent',
                  color: filter === gFilter ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  transition: 'all 0.3s'
                }}
              >
                {gFilter === 'live' ? '🔴 Live' : gFilter}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '2rem' }}>
            {loading ? (
              Array(6).fill(0).map((_, i) => <CardSkeleton key={i} />)
            ) : filteredEvents.length > 0 ? (
              filteredEvents.map((event, i) => (
                <motion.div key={event.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, delay: i * 0.05 }} layout>
                  <EventCard
                    event={event}
                    onClick={() => handleSelectEvent(event)}
                  />
                </motion.div>
              ))
            ) : (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
                <p>No {filter} events found at the moment.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detail Modal */}
      <Modal isOpen={!!selectedEvent} onClose={() => setSelectedEvent(null)}>
        {selectedEvent && (
          <div style={{ color: 'var(--text-primary)' }}>
            <div style={{ height: '200px', borderRadius: '12px', overflow: 'hidden', marginBottom: '24px', background: 'var(--border-light)' }}>
              <img
                src={selectedEvent.image || '/placeholder-event.jpg'}
                alt={selectedEvent.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100"><rect fill="%231e293b" width="100" height="100"/><text fill="%2394a3b8" x="50" y="50" font-family="sans-serif" font-size="5" text-anchor="middle" alignment-baseline="middle">EVENT IMG</text></svg>';
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {selectedEvent.type && <span className="badge badge-green">{selectedEvent.type}</span>}
              {selectedEvent.mode && <span className="badge badge-yellow">{selectedEvent.mode}</span>}
              {selectedEvent.status === 'upcoming' && <span className="badge badge-blue">Upcoming</span>}
              {(selectedEvent.status === 'live' || selectedEvent.status === 'ongoing') && <span className="badge badge-accent">🔴 Live</span>}
              {(selectedEvent.status === 'completed' || selectedEvent.status === 'past') && <span className="badge badge-muted">Completed</span>}
            </div>

            <h2 style={{ fontSize: '2rem', marginBottom: '20px' }}>{selectedEvent.title}</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px', background: 'var(--bg-primary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <FaCalendarAlt style={{ color: 'var(--accent)' }} /> <span>{new Date(selectedEvent.date).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <FaMapMarkerAlt style={{ color: 'var(--accent)' }} /> <span>{selectedEvent.venue}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <FaTag style={{ color: 'var(--accent)' }} /> <span>Type: {selectedEvent.type || 'Solo'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <FaTag style={{ color: 'var(--accent)' }} /> <span>Mode: {selectedEvent.mode || 'Intra-College'}</span>
              </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FaRegFileAlt style={{ color: 'var(--accent)' }} /> Description
              </h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{selectedEvent.description}</p>
            </div>

            {/* Lifecycle Action Area */}
            {selectedEvent.status === 'upcoming' && (
              <button
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '16px', fontSize: '1.1rem' }}
                onClick={handleInitiateRegistration}
              >
                Register Now
              </button>
            )}

            {(selectedEvent.status === 'live' || selectedEvent.status === 'ongoing') && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                padding: '16px',
                borderRadius: '12px',
                textAlign: 'center',
                fontWeight: 600,
                fontSize: '1rem'
              }}>
                🔴 This event is currently LIVE. Registrations are closed.
              </div>
            )}

            {(selectedEvent.status === 'completed' || selectedEvent.status === 'past') && (() => {
              const results = selectedEvent.openResults || selectedEvent.results || selectedEvent.winners;
              const hasPodium = results && results.first && results.first.name;

              // 1. If podium winners were declared (1st, 2nd, 3rd), display the podium
              if (hasPodium) {
                const podium = [
                  { pos: '1st', emoji: '🥇', data: results.first },
                  { pos: '2nd', emoji: '🥈', data: results.second },
                  { pos: '3rd', emoji: '🥉', data: results.third },
                ].filter(p => p.data && p.data.name);

                return (
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.08), rgba(0, 255, 136, 0.05))',
                    border: '1px solid rgba(250, 204, 21, 0.3)',
                    borderRadius: '16px',
                    padding: '20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: '1.3rem' }}>🏆</span>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Event Results</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {podium.map(({ pos, emoji, data }) => (
                        <div key={pos} style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                        }}>
                          <span style={{ fontSize: '1.5rem', minWidth: 32 }}>{emoji}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{data.name}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                              {pos} Place {data.teamLeader && `• Leader: ${data.teamLeader}`}
                            </div>
                          </div>
                          {typeof data.score === 'number' && (
                            <span style={{ fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-heading)', fontSize: '1rem' }}>
                              {data.score} pts
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              // 2. Otherwise, check for top performers by points
              const scoredCandidates = (
                Array.isArray(selectedEvent.topPerformers) && selectedEvent.topPerformers.length > 0
                  ? selectedEvent.topPerformers
                  : completedEventRegs
              )
                .filter((r: any) => typeof r.score === 'number' && r.score > 0)
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, 3);

              if (completedRegsLoading && scoredCandidates.length === 0) {
                return (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Loading results...
                  </div>
                );
              }

              if (scoredCandidates.length > 0) {
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(0, 255, 136, 0.06), rgba(0, 204, 255, 0.04))',
                    border: '1px solid rgba(0, 255, 136, 0.2)',
                    borderRadius: '16px',
                    padding: '20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: '1.3rem' }}>🏆</span>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Top Performers</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {scoredCandidates.map((r: any, idx: number) => (
                        <div key={r.id || idx} style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                        }}>
                          <span style={{ fontSize: '1.5rem', minWidth: 32 }}>{medals[idx]}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                              {r.type === 'Team' ? (r.name?.startsWith('Team:') ? r.name : (r.teamName ? `Team: ${r.teamName}` : r.name)) : r.name}
                            </div>
                            {r.type === 'Team' && r.teamLeader && (
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Leader: {r.teamLeader}</div>
                            )}
                          </div>
                          <span style={{ fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-heading)', fontSize: '1rem' }}>
                            {r.score} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <div style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  padding: '16px',
                  borderRadius: '12px',
                  textAlign: 'center',
                  fontWeight: 500,
                  fontSize: '1rem'
                }}>
                  🏁 Event Completed — Waiting for the result.
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Registration Form Modal */}
      <Modal
        isOpen={isRegModalOpen}
        onClose={() => setIsRegModalOpen(false)}
        title={`Register: ${selectedEvent?.title || ''}`}
      >
        {selectedEvent && (
          <form onSubmit={handleRegistrationSubmit}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <span className="badge badge-green">Type: {selectedEvent.type || 'Solo'}</span>
              <span className="badge badge-yellow">Mode: {selectedEvent.mode || 'Intra-College'}</span>
              {selectedEvent.mode === 'Open' ? (
                <span className="badge badge-blue">Requires Admin Verification</span>
              ) : (
                <span className="badge badge-accent">Auto Verified (Member Login)</span>
              )}
            </div>

            {/* SOLO REGISTRATION */}
            {selectedEvent.type === 'Solo' && (
              <>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Full Name *</span>
                    {currentUser && memberProfile?.name && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <FaLock /> Locked (From Profile)
                      </span>
                    )}
                  </label>
                  <input
                    required
                    type="text"
                    className="form-input"
                    placeholder="e.g. Rahul Sharma"
                    value={soloForm.name}
                    readOnly={Boolean(currentUser && memberProfile?.name)}
                    style={currentUser && memberProfile?.name ? { background: 'var(--bg-secondary)', cursor: 'not-allowed', opacity: 0.85 } : {}}
                    onChange={(e) => setSoloForm({ ...soloForm, name: e.target.value })}
                  />
                </div>

                {selectedEvent.mode === 'Open' && (
                  <div className="form-group">
                    <label className="form-label">College / Institute Name *</label>
                    <input
                      required
                      type="text"
                      className="form-input"
                      placeholder="e.g. NIELIT / Delhi University"
                      value={soloForm.college}
                      onChange={(e) => setSoloForm({ ...soloForm, college: e.target.value })}
                    />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Branch / Course *</label>
                    <input
                      required
                      type="text"
                      className="form-input"
                      placeholder="e.g. CSE / IT / BCA"
                      value={soloForm.branch}
                      onChange={(e) => setSoloForm({ ...soloForm, branch: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Registration Number *</span>
                      {currentUser && memberProfile?.registrationNumber && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FaLock /> Locked (From Profile)
                        </span>
                      )}
                    </label>
                    <input
                      required
                      type="text"
                      className="form-input"
                      placeholder="e.g. 22NIELIT104"
                      value={soloForm.regNumber}
                      readOnly={Boolean(currentUser && memberProfile?.registrationNumber)}
                      style={currentUser && memberProfile?.registrationNumber ? { background: 'var(--bg-secondary)', cursor: 'not-allowed', opacity: 0.85 } : {}}
                      onChange={(e) => setSoloForm({ ...soloForm, regNumber: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Year *</label>
                    <select
                      className="form-input"
                      value={soloForm.year}
                      onChange={(e) => setSoloForm({ ...soloForm, year: e.target.value })}
                    >
                      <option value="1st Year">1st Year</option>
                      <option value="2nd Year">2nd Year</option>
                      <option value="3rd Year">3rd Year</option>
                      <option value="4th Year">4th Year</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Semester *</label>
                    <select
                      className="form-input"
                      value={soloForm.semester}
                      onChange={(e) => setSoloForm({ ...soloForm, semester: e.target.value })}
                    >
                      {['1st', '2nd'].map(s => (
                        <option key={s} value={s}>{s} Sem</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
            
            {/* TEAM REGISTRATION */}
            {selectedEvent.type === 'Team' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Team Name *</label>
                    <input
                      required
                      type="text"
                      className="form-input"
                      placeholder="e.g. CodeCraft"
                      value={teamForm.teamName}
                      onChange={(e) => setTeamForm({ ...teamForm, teamName: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Team Leader Name *</span>
                      {currentUser && memberProfile?.name && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FaLock /> Locked
                        </span>
                      )}
                    </label>
                    <input
                      required
                      type="text"
                      className="form-input"
                      placeholder="Leader Name"
                      value={teamForm.teamLeader}
                      readOnly={Boolean(currentUser && memberProfile?.name)}
                      style={currentUser && memberProfile?.name ? { background: 'var(--bg-secondary)', cursor: 'not-allowed', opacity: 0.85 } : {}}
                      onChange={(e) => setTeamForm({ ...teamForm, teamLeader: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: selectedEvent.mode === 'Open' ? '1fr 1fr' : '1fr', gap: '16px' }}>
                  {selectedEvent.mode === 'Open' && (
                    <div className="form-group">
                      <label className="form-label">College / Institute *</label>
                      <input
                        required
                        type="text"
                        className="form-input"
                        placeholder="e.g. NIELIT / Delhi University"
                        value={teamForm.college}
                        onChange={(e) => setTeamForm({ ...teamForm, college: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Number of Members *</label>
                    <select
                      className="form-input"
                      value={teamForm.memberCount}
                      onChange={(e) => handleMemberCountChange(Number(e.target.value))}
                    >
                      <option value={2}>2 Members</option>
                      <option value={3}>3 Members</option>
                      <option value={4}>4 Members</option>
                      <option value={5}>5 Members</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: '16px', marginBottom: '8px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                  <h4 style={{ fontSize: '1rem', color: 'var(--accent)', marginBottom: '12px' }}>Member Details</h4>
                  {teamForm.members.map((member, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: 'var(--bg-secondary)',
                        padding: '14px',
                        borderRadius: '10px',
                        border: '1px solid var(--border)',
                        marginBottom: '14px'
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-primary)' }}>
                        Member #{idx + 1} {idx === 0 ? '(Leader)' : ''}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Name *</span>
                            {idx === 0 && currentUser && memberProfile?.name && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <FaLock /> Locked
                              </span>
                            )}
                          </label>
                          <input
                            required
                            type="text"
                            className="form-input"
                            placeholder="Full Name"
                            value={member.name}
                            readOnly={idx === 0 && Boolean(currentUser && memberProfile?.name)}
                            style={idx === 0 && currentUser && memberProfile?.name ? { background: 'var(--bg-primary)', cursor: 'not-allowed', opacity: 0.85 } : {}}
                            onChange={(e) => handleMemberFieldChange(idx, 'name', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Registration Number *</span>
                            {idx === 0 && currentUser && memberProfile?.registrationNumber && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <FaLock /> Locked
                              </span>
                            )}
                          </label>
                          <input
                            required
                            type="text"
                            className="form-input"
                            placeholder="e.g. 22NIELIT101"
                            value={member.regNumber}
                            readOnly={idx === 0 && Boolean(currentUser && memberProfile?.registrationNumber)}
                            style={idx === 0 && currentUser && memberProfile?.registrationNumber ? { background: 'var(--bg-primary)', cursor: 'not-allowed', opacity: 0.85 } : {}}
                            onChange={(e) => handleMemberFieldChange(idx, 'regNumber', e.target.value)}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>Branch *</label>
                          <input
                            required
                            type="text"
                            className="form-input"
                            placeholder="Branch"
                            value={member.branch}
                            onChange={(e) => handleMemberFieldChange(idx, 'branch', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>Year *</label>
                          <select
                            className="form-input"
                            value={member.year}
                            onChange={(e) => handleMemberFieldChange(idx, 'year', e.target.value)}
                          >
                            <option value="1st Year">1st Year</option>
                            <option value="2nd Year">2nd Year</option>
                            <option value="3rd Year">3rd Year</option>
                            <option value="4th Year">4th Year</option>
                          </select>
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>Semester *</label>
                          <select
                            className="form-input"
                            value={member.semester}
                            onChange={(e) => handleMemberFieldChange(idx, 'semester', e.target.value)}
                          >
                            {['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'].map(s => (
                              <option key={s} value={s}>{s} Sem</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '16px', marginTop: '16px' }}
              disabled={submittingReg}
            >
              {submittingReg ? 'Submitting Registration...' : 'Complete Registration'}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}