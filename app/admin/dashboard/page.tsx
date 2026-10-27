'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, getDocs, getDoc, deleteDoc, doc, updateDoc, addDoc, setDoc, query, where, increment } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  FaSignOutAlt, FaCalendarAlt, FaProjectDiagram, FaPenNib,
  FaUsers, FaEnvelope, FaTrash, FaEdit, FaPlus, FaTrophy, FaCheckCircle, FaTimes, FaUserCheck, FaMedal,
  FaExternalLinkAlt, FaGithub, FaEye, FaFileAlt, FaSyncAlt, FaCopy, FaBookOpen, FaUser, FaClock
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import { seedFirestore } from '@/lib/seedFirestore';
import Modal from '@/components/Modal';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBlogContentMarkdown(content: string) {
  if (!content) return null;
  return content.split('\n\n').map((paragraph: string, i: number) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={i} style={{ fontSize: '1.35rem', marginTop: '1.5rem', marginBottom: '0.6rem', color: 'var(--accent)', fontFamily: 'var(--font-heading)' }}>
          {trimmed.replace('## ', '')}
        </h2>
      );
    }
    if (trimmed.startsWith('### ')) {
      return (
        <h3 key={i} style={{ fontSize: '1.15rem', marginTop: '1.2rem', marginBottom: '0.5rem', color: 'var(--text-primary)', fontFamily: 'var(--font-heading)' }}>
          {trimmed.replace('### ', '')}
        </h3>
      );
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items = trimmed.split('\n').map(item => item.replace(/^[-*]\s+/, ''));
      return (
        <ul key={i} style={{ paddingLeft: '1.5rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          {items.map((item, j) => <li key={j} style={{ marginBottom: '0.35rem' }}>{item}</li>)}
        </ul>
      );
    }
    if (trimmed.match(/^\d+\. /)) {
      const items = trimmed.split('\n').map(item => item.replace(/^\d+\.\s+/, ''));
      return (
        <ol key={i} style={{ paddingLeft: '1.5rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          {items.map((item, j) => <li key={j} style={{ marginBottom: '0.35rem' }}>{item}</li>)}
        </ol>
      );
    }
    if (trimmed.startsWith('```')) {
      const lines = trimmed.split('\n');
      const code = lines.slice(1, lines[lines.length - 1].startsWith('```') ? -1 : undefined).join('\n');
      return (
        <pre key={i} style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem' }}>
          <code style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{code}</code>
        </pre>
      );
    }
    if (/\*\*(.*?)\*\*/.test(trimmed)) {
      const safeHtml = escapeHtml(trimmed).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return <p key={i} style={{ marginBottom: '1rem', lineHeight: 1.65, color: 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
    }
    return <p key={i} style={{ marginBottom: '1rem', lineHeight: 1.65, color: 'var(--text-secondary)' }}>{trimmed}</p>;
  });
}

export default function AdminDashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('events');
  const [data, setData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [syncingProfiles, setSyncingProfiles] = useState(false);

  const handleSyncProfiles = async () => {
    setSyncingProfiles(true);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      const res = await fetch('/api/admin/sync-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
      });
      const resData = await res.json();
      if (!res.ok) {
        toast.error(resData.error || 'Failed to sync profiles');
      } else {
        toast.success(`Successfully synced ${resData.syncedCount || 0} members to public leaderboard!`);
        fetchData(activeTab);
      }
    } catch (err: any) {
      toast.error('Sync error: ' + (err?.message || 'Unknown'));
    } finally {
      setSyncingProfiles(false);
    }
  };

  // Modal & Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState<any>({});

  // Destructive delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; collectionName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Project status filter state
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Detail inspection modal state (e.g. project description, blog excerpt/content, contact message)
  const [viewingDetailItem, setViewingDetailItem] = useState<any | null>(null);
  const [blogContentTab, setBlogContentTab] = useState<'preview' | 'raw'>('preview');
  const [fetchingBlogContent, setFetchingBlogContent] = useState(false);

  // Fetch live blog content from Firebase on-demand
  const handleFetchLiveBlogContent = async (blogId: string) => {
    setFetchingBlogContent(true);
    try {
      const snap = await getDoc(doc(db, 'blogs', blogId));
      if (snap.exists()) {
        const liveData = snap.data();
        const content = liveData.content || liveData.body || liveData.article || liveData.text || '';
        setViewingDetailItem((prev: any) => (prev ? { ...prev, ...liveData, content } : null));
        setData((prevData) =>
          prevData.map((d) => (d.id === blogId ? { ...d, ...liveData, content } : d))
        );
        toast.success('Latest article content fetched from Firebase!');
      } else {
        toast.error('Blog document not found in Firebase.');
      }
    } catch (err: any) {
      console.error('Error fetching blog content:', err);
      toast.error(`Failed to fetch from Firebase: ${err?.message || 'Error'}`);
    } finally {
      setFetchingBlogContent(false);
    }
  };

  const handleOpenBlogInspection = (item: any) => {
    setViewingDetailItem({ ...item, _type: 'blogs' });
    setBlogContentTab('preview');
    if (!item.content) {
      handleFetchLiveBlogContent(item.id);
    }
  };

  // Event Registrations & Scoring State
  const [eventRegCounts, setEventRegCounts] = useState<Record<string, number>>({});
  const [selectedEventForRegs, setSelectedEventForRegs] = useState<any | null>(null);
  const [eventRegs, setEventRegs] = useState<any[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [scoringScores, setScoringScores] = useState<Record<string, number>>({});
  const [savingScoreId, setSavingScoreId] = useState<string | null>(null);

  // Open mode position picker state
  // openResultDraft: { first: regId|'', second: regId|'', third: regId|'' }
  const [openResultDraft, setOpenResultDraft] = useState<{ first: string; second: string; third: string }>({
    first: '', second: '', third: ''
  });
  const [savingOpenResults, setSavingOpenResults] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        localStorage.removeItem('devnest_admin');
        toast.error('Unauthorized access. Please login.');
        router.push('/admin');
        return;
      }

      try {
        const tokenResult = await currentUser.getIdTokenResult(true);
        if (!tokenResult.claims.admin) {
          await signOut(auth);
          localStorage.removeItem('devnest_admin');
          toast.error('Access denied: Administrator privileges required.');
          router.push('/admin');
          return;
        }

        setUser(currentUser);
        localStorage.setItem('devnest_admin', 'true');
        setLoading(false);
        fetchData('events');
      } catch (err) {
        console.error('Admin token verification error:', err);
        await signOut(auth);
        localStorage.removeItem('devnest_admin');
        toast.error('Session verification failed. Please login again.');
        router.push('/admin');
      }
    });

    return () => unsubscribe();
  }, [router]);


  const fetchData = async (collectionName: string) => {
    setActiveTab(collectionName);
    setDataLoading(true);
    try {
      if (collectionName === 'leaderboard') {
        const querySnapshot = await getDocs(query(collection(db, 'members'), where('status', '==', 'approved')));
        const items = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a: any, b: any) => (Number(b.currentMonthPoints) || 0) - (Number(a.currentMonthPoints) || 0));
        setData(items);
      } else {
        const querySnapshot = await getDocs(collection(db, collectionName));
        const items = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setData(items);

        if (collectionName === 'events') {
          const countsMap: Record<string, number> = {};
          await Promise.all(items.map(async (ev) => {
            try {
              const regSnap = await getDocs(collection(db, 'events', ev.id, 'registrations'));
              countsMap[ev.id] = regSnap.size;
            } catch {
              countsMap[ev.id] = 0;
            }
          }));
          setEventRegCounts(countsMap);
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setData([]);
    } finally {
      setDataLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('devnest_admin');
      router.push('/admin');
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDelete = (id: string, name: string, collectionName: string) => {
    setDeleteTarget({ id, name, collectionName });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // Force refresh admin token to ensure latest custom claims are sent to Firestore
      const idToken = await auth.currentUser?.getIdToken(true);

      const { id, collectionName } = deleteTarget;

      if (collectionName === 'members') {
        const res = await fetch('/api/admin/delete-member', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ memberId: id }),
        });
        const result = await res.json();
        if (!res.ok) {
          throw new Error(result.error || 'Failed to delete member and authentication account');
        }
      } else {
        // 1. Delete main document
        await deleteDoc(doc(db, collectionName, id));

        // 2. Cascade delete for related documents
        if (collectionName === 'events') {
          try {
            const regSnap = await getDocs(collection(db, 'events', id, 'registrations'));
            await Promise.all(regSnap.docs.map(d => deleteDoc(d.ref)));
          } catch (_) {}
        }
      }

      toast.success(`${deleteTarget.name} deleted successfully!`);
      setDeleteTarget(null);
      fetchData(activeTab);
    } catch (error: any) {
      console.error('Delete error for', deleteTarget, error);
      toast.error(`Delete failed: ${error?.message || 'Permission denied. Ensure your admin custom claim is set.'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleRead = async (item: any) => {
    try {
      await auth.currentUser?.getIdToken(true);
      await updateDoc(doc(db, 'contacts', item.id), { read: !item.read });
      toast.success(item.read ? 'Marked as unread' : 'Marked as read');
      fetchData('contacts');
    } catch (error: any) {
      console.error('Failed to update message status:', error);
      toast.error(`Failed to update message status: ${error?.message || 'Permission denied'}`);
    }
  };

  // Approve a pending member
  const handleApproveMember = async (memberId: string) => {
    if (!window.confirm('Approve this member? This will activate their login account.')) return;

    setApprovingId(memberId);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      const res = await fetch('/api/admin/approve-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ memberId }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || 'Failed to approve member');
      } else {
        toast.success('Member approved! Account activated.');
        fetchData('members');
      }
    } catch (err: any) {
      console.error('Approval error:', err);
      toast.error(`Failed to approve member: ${err?.message || 'Server error'}`);
    } finally {
      setApprovingId(null);
    }
  };

  // Approve a pending blog
  const handleApproveBlog = async (blogId: string) => {
    if (!window.confirm('Approve this article? It will immediately become publicly visible at /blog/[slug].')) return;

    try {
      await auth.currentUser?.getIdToken(true);
      await updateDoc(doc(db, 'blogs', blogId), {
        status: 'approved',
        updatedAt: new Date().toISOString()
      });
      toast.success('Article approved! It is now publicly visible.');
      fetchData('blogs');
    } catch (err: any) {
      console.error('Approve blog error:', err);
      toast.error(`Failed to approve article: ${err?.message || 'Permission denied'}`);
    }
  };

  // Approve a pending project
  const handleApproveProject = async (projectId: string) => {
    if (!window.confirm('Approve this project? It will become visible on the public Projects page and in the member\'s dashboard.')) return;

    try {
      await auth.currentUser?.getIdToken(true);
      await updateDoc(doc(db, 'projects', projectId), {
        status: 'approved',
        verifiedAt: new Date().toISOString(),
        verifiedBy: user?.email || 'admin',
        updatedAt: new Date().toISOString()
      });
      toast.success('Project approved! It is now publicly visible and in the member\'s dashboard.');
      if (viewingDetailItem && viewingDetailItem.id === projectId) {
        setViewingDetailItem((prev: any) => ({ ...prev, status: 'approved' }));
      }
      fetchData('projects');
    } catch (err: any) {
      console.error('Approve project error:', err);
      toast.error(`Failed to approve project: ${err?.message || 'Permission denied'}`);
    }
  };

  // Reject a project submission
  const handleRejectProject = async (projectId: string) => {
    const reason = window.prompt(
      'Enter reason for rejection (this will be shown to the member in their dashboard):',
      'Does not meet submission guidelines or is incomplete.'
    );
    if (reason === null) return; // Admin cancelled

    try {
      await auth.currentUser?.getIdToken(true);
      await updateDoc(doc(db, 'projects', projectId), {
        status: 'rejected',
        rejectionReason: reason.trim() || 'Does not meet submission guidelines.',
        rejectedAt: new Date().toISOString(),
        rejectedBy: user?.email || 'admin',
        updatedAt: new Date().toISOString()
      });
      toast.success('Project marked as rejected.');
      if (viewingDetailItem && viewingDetailItem.id === projectId) {
        setViewingDetailItem((prev: any) => ({
          ...prev,
          status: 'rejected',
          rejectionReason: reason.trim() || 'Does not meet submission guidelines.'
        }));
      }
      fetchData('projects');
    } catch (err: any) {
      console.error('Reject project error:', err);
      toast.error(`Failed to reject project: ${err?.message || 'Permission denied'}`);
    }
  };

  // Approve a profile update request
  const handleApproveProfileUpdate = async (request: any) => {
    if (!window.confirm(`Approve profile updates for ${request.memberName || 'this member'}?`)) return;

    try {
      await auth.currentUser?.getIdToken(true);

      // 1. Update the member document
      if (request.memberDocId && request.requestedData) {
        await updateDoc(doc(db, 'members', request.memberDocId), {
          ...request.requestedData,
          updatedAt: new Date().toISOString()
        });

        // 2. Also update memberProfiles if it exists
        try {
          await updateDoc(doc(db, 'memberProfiles', request.memberDocId), {
            ...request.requestedData,
            updatedAt: new Date().toISOString()
          });
        } catch (_) {
          // memberProfiles doc may not exist, non-fatal
        }
      }

      // 3. Update the request status
      await updateDoc(doc(db, 'profileUpdateRequests', request.id), {
        status: 'approved',
        reviewedAt: new Date().toISOString()
      });

      toast.success('Profile update approved and applied!');
      fetchData('profileUpdateRequests');
    } catch (err: any) {
      console.error('Failed to approve profile update:', err);
      toast.error(`Failed to approve profile update: ${err?.message || 'Permission denied'}`);
    }
  };

  // Reject a profile update request
  const handleRejectProfileUpdate = async (request: any) => {
    if (!window.confirm(`Reject profile updates for ${request.memberName || 'this member'}? Details will remain unchanged.`)) return;

    try {
      await auth.currentUser?.getIdToken(true);
      await updateDoc(doc(db, 'profileUpdateRequests', request.id), {
        status: 'rejected',
        reviewedAt: new Date().toISOString()
      });

      toast.success('Profile update rejected.');
      fetchData('profileUpdateRequests');
    } catch (err: any) {
      console.error('Failed to reject profile update:', err);
      toast.error(`Failed to reject profile update: ${err?.message || 'Permission denied'}`);
    }
  };

  // Open Registrations & Scoring Modal for an Event
  const handleOpenRegistrationsModal = async (eventItem: any) => {
    setSelectedEventForRegs(eventItem);
    setRegsLoading(true);
    // Reset open result draft from existing event data
    setOpenResultDraft({
      first: eventItem.openResults?.first?.regId || eventItem.results?.first?.regId || '',
      second: eventItem.openResults?.second?.regId || eventItem.results?.second?.regId || '',
      third: eventItem.openResults?.third?.regId || eventItem.results?.third?.regId || '',
    });
    try {
      const snap = await getDocs(collection(db, 'events', eventItem.id, 'registrations'));
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEventRegs(items);
      const scores: Record<string, number> = {};
      items.forEach((item: any) => {
        if (typeof item.score === 'number') {
          scores[item.id] = item.score;
        }
      });
      setScoringScores(scores);
    } catch (err) {
      console.error('Failed to load registrations:', err);
      toast.error('Could not load registrations');
    } finally {
      setRegsLoading(false);
    }
  };

  // Save position results / winners to the event doc
  const handleSaveOpenResults = async () => {
    if (!selectedEventForRegs) return;
    if (!openResultDraft.first) {
      toast.error('Please select at least the 1st place.');
      return;
    }

    const getRegName = (regId: string) => {
      const reg = eventRegs.find(r => r.id === regId);
      if (!reg) return '';
      return reg.type === 'Team' ? (reg.teamName || reg.name) : reg.name;
    };

    const buildEntry = (regId: string) => {
      const reg = eventRegs.find(r => r.id === regId);
      const score = reg && typeof reg.score === 'number' ? reg.score : (scoringScores[regId] !== undefined ? Number(scoringScores[regId]) : undefined);
      return {
        regId,
        name: getRegName(regId),
        score: typeof score === 'number' && !isNaN(score) ? score : undefined,
        type: reg?.type || 'Solo',
        teamLeader: reg?.type === 'Team' ? reg.teamLeader : undefined
      };
    };

    const openResults: any = { first: buildEntry(openResultDraft.first) };
    if (openResultDraft.second) openResults.second = buildEntry(openResultDraft.second);
    if (openResultDraft.third) openResults.third = buildEntry(openResultDraft.third);

    setSavingOpenResults(true);
    try {
      await updateDoc(doc(db, 'events', selectedEventForRegs.id), { 
        openResults,
        results: openResults 
      });
      // Also update local selectedEventForRegs so UI refreshes
      setSelectedEventForRegs((prev: any) => ({ ...prev, openResults, results: openResults }));
      toast.success('Results saved successfully!');
    } catch (err) {
      console.error('Failed to save results:', err);
      toast.error('Failed to save results');
    } finally {
      setSavingOpenResults(false);
    }
  };

  // Award points to a member identified by their unique registration number.
  // Updates BOTH the members doc and the memberProfiles doc (the public
  // leaderboard reads memberProfiles). Returns true if a member was found.
  const awardPointsByRegNumber = async (regNumber: string, diff: number): Promise<boolean> => {
    try {
      const memberQuery = query(collection(db, 'members'), where('registrationNumber', '==', regNumber));
      const memberSnap = await getDocs(memberQuery);
      if (memberSnap.empty) return false;
      const memberDoc = memberSnap.docs[0];
      await applyPointsToMember(memberDoc.ref, memberDoc.id, memberDoc.data(), diff);
      return true;
    } catch (err) {
      console.warn(`Could not award points to regNumber ${regNumber}:`, err);
      return false;
    }
  };

  // Legacy fallback: resolve the member by Firebase Auth uid.
  const awardPointsByUid = async (uid: string, diff: number): Promise<boolean> => {
    try {
      const memberQuery = query(collection(db, 'members'), where('uid', '==', uid));
      const memberSnap = await getDocs(memberQuery);
      if (memberSnap.empty) return false;
      const memberDoc = memberSnap.docs[0];
      await applyPointsToMember(memberDoc.ref, memberDoc.id, memberDoc.data(), diff);
      return true;
    } catch (err) {
      console.warn('Could not award points by uid:', err);
      return false;
    }
  };

  // Shared points update with lazy monthly reset. Applied to members and
  // mirrored to memberProfiles so the public leaderboard stays in sync.
  const applyPointsToMember = async (memberRef: any, memberId: string, memberData: any, diff: number) => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const membersPayload: any = { totalPoints: increment(diff) };
    const profilePayload: any = { totalPoints: increment(diff) };
    if (memberData.lastResetMonth && memberData.lastResetMonth !== currentMonthKey) {
      // New month: reset the monthly counter before adding
      const resetVal = diff > 0 ? diff : 0;
      membersPayload.currentMonthPoints = resetVal;
      membersPayload.lastResetMonth = currentMonthKey;
      profilePayload.currentMonthPoints = resetVal;
      profilePayload.lastResetMonth = currentMonthKey;
    } else {
      membersPayload.currentMonthPoints = increment(diff);
      profilePayload.currentMonthPoints = increment(diff);
      if (!memberData.lastResetMonth) {
        membersPayload.lastResetMonth = currentMonthKey;
        profilePayload.lastResetMonth = currentMonthKey;
      }
    }
    await updateDoc(memberRef, membersPayload);
    try {
      await updateDoc(doc(db, 'memberProfiles', memberId), profilePayload);
    } catch (profileErr) {
      console.warn('memberProfiles points sync failed (non-fatal):', profileErr);
    }
  };

  const handleSaveScore = async (regId: string) => {
    if (!selectedEventForRegs) return;
    const scoreVal = Number(scoringScores[regId]);
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100) {
      toast.error('Please enter a valid score between 0 and 100');
      return;
    }
    setSavingScoreId(regId);
    try {
      const reg = eventRegs.find(r => r.id === regId);
      const prevScore = typeof reg?.score === 'number' ? reg.score : 0;
      const scoreDiff = scoreVal - prevScore;

      await updateDoc(doc(db, 'events', selectedEventForRegs.id, 'registrations', regId), {
        score: scoreVal,
        scoredAt: new Date().toISOString()
      });

      // Award points by REGISTRATION NUMBER (the unique identifier).
      // Solo entry -> the participant's regNumber.
      // Team entry -> EVERY team member's regNumber receives the points.
      if (scoreDiff !== 0) {
        const regNumbers: string[] = reg?.type === 'Team' && Array.isArray(reg?.members)
          ? reg.members.map((m: any) => (m.regNumber || '').trim()).filter(Boolean)
          : [((reg?.regNumber || '') as string).trim()].filter(Boolean);
        const uniqueRegNumbers = [...new Set(regNumbers)];
        let awarded = 0;
        const notFound: string[] = [];
        for (const rn of uniqueRegNumbers) {
          const ok = await awardPointsByRegNumber(rn, scoreDiff);
          if (ok) awarded += 1; else notFound.push(rn);
        }
        // Legacy fallback: registration without a regNumber -> resolve via uid
        if (uniqueRegNumbers.length === 0 && reg?.submittedByUid) {
          const ok = await awardPointsByUid(reg.submittedByUid, scoreDiff);
          if (ok) awarded += 1;
        }
        if (awarded > 0) {
          toast.success(
            `Points saved! Awarded to ${awarded} member${awarded > 1 ? 's' : ''}` +
            (notFound.length > 0 ? ` (${notFound.length} reg. no. not found: ${notFound.join(', ')})` : '')
          );
        } else if (uniqueRegNumbers.length > 0) {
          toast.error(`Score saved, but no member found for reg. no.: ${notFound.join(', ')}`);
        } else {
          toast.success('Points saved successfully!');
        }
      } else {
        toast.success('Points saved successfully!');
      }

      const updatedRegs = eventRegs.map(r => r.id === regId ? { ...r, score: scoreVal } : r);
      setEventRegs(updatedRegs);

      // Compute and persist topPerformers on the public event doc so public visitors see results immediately
      const topScored = updatedRegs
        .filter((r: any) => typeof r.score === 'number' && r.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3)
        .map(r => ({
          id: r.id,
          name: r.type === 'Team' ? (r.teamName || r.name) : r.name,
          type: r.type || 'Solo',
          teamLeader: r.type === 'Team' ? r.teamLeader : undefined,
          score: r.score
        }));

      if (topScored.length > 0) {
        await updateDoc(doc(db, 'events', selectedEventForRegs.id), {
          topPerformers: topScored
        });
        setSelectedEventForRegs((prev: any) => ({ ...prev, topPerformers: topScored }));
      }
    } catch (err) {
      console.error('Score update failed:', err);
      toast.error('Failed to save score');
    } finally {
      setSavingScoreId(null);
    }
  };

  const handleUpdateRegStatus = async (regId: string, status: 'approved' | 'rejected') => {
    if (!selectedEventForRegs) return;
    try {
      await updateDoc(doc(db, 'events', selectedEventForRegs.id, 'registrations', regId), {
        status,
        verifiedAt: new Date().toISOString()
      });
      toast.success(`Registration ${status}!`);
      setEventRegs(prev => prev.map(r => r.id === regId ? { ...r, status } : r));
    } catch (err) {
      console.error(err);
      toast.error('Failed to update registration status');
    }
  };

  const handleOpenAddModal = () => {
    setEditingItem(null);
    if (activeTab === 'events') {
      setFormData({
        title: '',
        description: '',
        image: '',
        date: '',
        venue: '',
        type: 'Solo',
        mode: 'Intra-College',
        status: 'upcoming'
      });
    } else if (activeTab === 'projects') {
      setFormData({ title: '', description: '', techStack: '', githubLink: '', liveLink: '', image: '', contributors: '', status: 'approved' });
    } else if (activeTab === 'blogs') {
      setFormData({ title: '', author: '', date: new Date().toISOString().split('T')[0], tags: '', readTime: '', thumbnail: '', excerpt: '', content: '', slug: '', status: 'approved' });
    } else if (activeTab === 'members') {
      setFormData({ name: '', email: '', registrationNumber: '', bio: '', github: '', linkedin: '', image: '', status: 'pending' });
    } else if (activeTab === 'leaderboard') {
      setFormData({ name: '', codeforcesRating: 1200, leetcodeProblems: 100, codechefStars: 3, totalScore: 1500 });
    }
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: any) => {
    setEditingItem(item);
    if (activeTab === 'events') {
      setFormData({
        title: item.title || '',
        description: item.description || '',
        image: item.image || '',
        date: item.date || '',
        venue: item.venue || '',
        type: item.type || 'Solo',
        mode: item.mode || 'Intra-College',
        status: item.status || 'upcoming'
      });
    } else if (activeTab === 'projects') {
      setFormData({
        title: item.title || '',
        description: item.description || '',
        techStack: Array.isArray(item.techStack) ? item.techStack.join(', ') : item.techStack || '',
        githubLink: item.githubLink || '',
        liveLink: item.liveLink || '',
        image: item.image || '',
        contributors: Array.isArray(item.contributors) ? item.contributors.join(', ') : item.contributors || '',
        status: item.status || 'pending'
      });
    } else if (activeTab === 'blogs') {
      setFormData({
        title: item.title || '',
        author: item.author || '',
        date: item.date || new Date().toISOString().split('T')[0],
        tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || '',
        readTime: item.readTime || '',
        thumbnail: item.thumbnail || '',
        excerpt: item.excerpt || '',
        content: item.content || '',
        slug: item.slug || '',
        status: item.status || 'pending'
      });
    } else if (activeTab === 'members') {
      setFormData({
        name: item.name || '',
        email: item.email || '',
        registrationNumber: item.registrationNumber || '',
        bio: item.bio || '',
        github: item.github || '',
        linkedin: item.linkedin || '',
        image: item.image || '',
        status: item.status || 'pending'
      });
    } else if (activeTab === 'leaderboard') {
      setFormData({
        name: item.name || '',
        codeforcesRating: item.codeforcesRating || 0,
        leetcodeProblems: item.leetcodeProblems || 0,
        codechefStars: item.codechefStars || 0,
        totalScore: item.totalScore || 0
      });
    }
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      let submitData: any = { ...formData };
      if (activeTab === 'projects') {
        submitData.techStack = typeof formData.techStack === 'string' ? formData.techStack.split(',').map((s: string) => s.trim()).filter(Boolean) : formData.techStack;
        submitData.contributors = typeof formData.contributors === 'string' ? formData.contributors.split(',').map((s: string) => s.trim()).filter(Boolean) : formData.contributors;
        submitData.status = formData.status || 'approved';
      } else if (activeTab === 'blogs') {
        submitData.tags = typeof formData.tags === 'string' ? formData.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : formData.tags;
        if (!submitData.slug) {
          submitData.slug = formData.title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        }
      } else if (activeTab === 'members') {
        submitData.registrationNumber = (formData.registrationNumber || '').trim().toUpperCase();
        submitData.email = (formData.email || '').trim().toLowerCase();
        submitData.name = (formData.name || '').trim();

        // Check if registrationNumber is unique
        if (submitData.registrationNumber) {
          const regQuery = query(collection(db, 'members'), where('registrationNumber', '==', submitData.registrationNumber));
          const regSnap = await getDocs(regQuery);
          const duplicate = regSnap.docs.find(d => !editingItem || d.id !== editingItem.id);
          if (duplicate) {
            setFormLoading(false);
            toast.error('A member with this Registration Number already exists.');
            return;
          }
        }
      } else if (activeTab === 'leaderboard') {
        submitData.codeforcesRating = Number(formData.codeforcesRating);
        submitData.leetcodeProblems = Number(formData.leetcodeProblems);
        submitData.codechefStars = Number(formData.codechefStars);
        submitData.totalScore = Number(formData.totalScore);
      }

      if (editingItem) {
        await updateDoc(doc(db, activeTab, editingItem.id), { ...submitData, updatedAt: new Date().toISOString() });
        if (activeTab === 'members') {
          try {
            await setDoc(doc(db, 'memberProfiles', editingItem.id), {
              name: submitData.name,
              registrationNumber: submitData.registrationNumber || '',
              image: submitData.image || '',
              bio: submitData.bio || '',
              github: submitData.github || '',
              linkedin: submitData.linkedin || '',
              status: submitData.status || 'approved',
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          } catch (profileErr) {
            console.warn('memberProfiles sync failed (non-fatal):', profileErr);
          }
        }
        toast.success('Updated successfully!');
      } else {
        const newRef = await addDoc(collection(db, activeTab), { ...submitData, createdAt: new Date().toISOString() });
        if (activeTab === 'members' && (submitData.status === 'approved' || !submitData.status)) {
          try {
            await setDoc(doc(db, 'memberProfiles', newRef.id), {
              name: submitData.name,
              registrationNumber: submitData.registrationNumber || '',
              image: submitData.image || '',
              bio: submitData.bio || '',
              github: submitData.github || '',
              linkedin: submitData.linkedin || '',
              status: 'approved',
              currentMonthPoints: Number(submitData.currentMonthPoints) || 0,
              totalPoints: Number(submitData.totalPoints) || 0,
              createdAt: new Date().toISOString(),
            }, { merge: true });
          } catch (profileErr) {
            console.warn('memberProfiles creation failed (non-fatal):', profileErr);
          }
        }
        toast.success('Added successfully!');
      }

      setIsModalOpen(false);
      fetchData(activeTab);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save item');
    } finally {
      setFormLoading(false);
    }
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading Secure Context...</div>;

  const tabs = [
    { id: 'events', label: 'Events', icon: <FaCalendarAlt /> },
    { id: 'projects', label: 'Projects', icon: <FaProjectDiagram /> },
    { id: 'blogs', label: 'Blog Posts', icon: <FaPenNib /> },
    { id: 'members', label: 'Members', icon: <FaUsers /> },
    { id: 'profileUpdateRequests', label: 'Profile Updates', icon: <FaUserCheck /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <FaTrophy /> },
    { id: 'contacts', label: 'Messages', icon: <FaEnvelope /> },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <div style={{ width: '280px', background: 'var(--bg-card)', borderRight: '1px solid var(--border)', padding: '24px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--accent)', fontWeight: 800 }}>Admin<span style={{ color: 'var(--text-primary)' }}>Panel</span></h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{user.email}</p>
        </div>

        <nav style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => fetchData(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 16px', borderRadius: '12px',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                background: activeTab === tab.id ? 'var(--accent-glow)' : 'transparent',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                fontWeight: activeTab === tab.id ? 600 : 500,
                transition: 'all 0.2s'
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>

        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '12px 16px', background: 'transparent',
            border: 'none', color: 'var(--danger)', cursor: 'pointer',
            fontWeight: 600, marginTop: 'auto'
          }}
        >
          <FaSignOutAlt /> Sign Out
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flexGrow: 1, padding: '40px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, textTransform: 'capitalize' }}>
            {activeTab === 'profileUpdateRequests' ? 'Member Profile Updates' : `Manage ${activeTab}`}
          </h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {(activeTab === 'members' || activeTab === 'leaderboard') && (
              <button
                className="btn-outline"
                style={{ padding: '9px 16px', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={handleSyncProfiles}
                disabled={syncingProfiles}
                title="Sync member registration numbers, points, and profiles to the public leaderboard"
              >
                <FaSyncAlt className={syncingProfiles ? 'spin' : ''} /> {syncingProfiles ? 'Syncing...' : 'Sync Public Leaderboard'}
              </button>
            )}
            {activeTab !== 'contacts' && activeTab !== 'profileUpdateRequests' && activeTab !== 'leaderboard' && (
              <button className="btn-primary" style={{ padding: '10px 20px', borderRadius: '8px' }} onClick={handleOpenAddModal}>
                <FaPlus /> Add New
              </button>
            )}
          </div>
        </div>

        {activeTab === 'projects' && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => {
              const count = st === 'all'
                ? data.length
                : data.filter((d: any) => (d.status || 'pending') === st).length;
              return (
                <button
                  key={st}
                  onClick={() => setProjectStatusFilter(st)}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '20px',
                    border: projectStatusFilter === st ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: projectStatusFilter === st ? 'var(--accent-glow)' : 'var(--bg-card)',
                    color: projectStatusFilter === st ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: projectStatusFilter === st ? 700 : 500,
                    textTransform: 'capitalize',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.2s'
                  }}
                >
                  {st === 'pending' ? '⏳ Pending Verification' : st === 'approved' ? '✓ Approved' : st === 'rejected' ? '✕ Rejected' : 'All'}
                  <span style={{
                    background: projectStatusFilter === st ? 'var(--accent)' : 'var(--border)',
                    color: projectStatusFilter === st ? '#000' : 'var(--text-dim)',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '0.72rem',
                    fontWeight: 700
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {(() => {
          const displayedData = activeTab === 'projects' && projectStatusFilter !== 'all'
            ? data.filter((d: any) => (d.status || 'pending') === projectStatusFilter)
            : data;

          return (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              {dataLoading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : displayedData.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.85rem' }}>
                        <th style={{ padding: '16px 24px' }}>Title / Name</th>
                        {activeTab === 'events' && <th style={{ padding: '16px 24px' }}>Date</th>}
                        {activeTab === 'events' && <th style={{ padding: '16px 24px' }}>Type</th>}
                        {activeTab === 'events' && <th style={{ padding: '16px 24px' }}>Mode</th>}
                        {activeTab === 'events' && <th style={{ padding: '16px 24px' }}>Status</th>}
                        {activeTab === 'events' && <th style={{ padding: '16px 24px' }}>Registrations</th>}
                        {activeTab === 'projects' && <th style={{ padding: '16px 24px' }}>Description</th>}
                        {activeTab === 'blogs' && <th style={{ padding: '16px 24px' }}>Excerpt</th>}
                        {activeTab === 'blogs' && <th style={{ padding: '16px 24px' }}>Uploaded Content</th>}
                        {(activeTab === 'projects' || activeTab === 'blogs') && <th style={{ padding: '16px 24px' }}>Status</th>}
                        {activeTab === 'projects' && <th style={{ padding: '16px 24px' }}>Links</th>}
                        {activeTab === 'members' && <th style={{ padding: '16px 24px' }}>Reg No</th>}
                        {activeTab === 'members' && <th style={{ padding: '16px 24px' }}>Email</th>}
                        {activeTab === 'members' && <th style={{ padding: '16px 24px' }}>Status</th>}
                        {activeTab === 'profileUpdateRequests' && <th style={{ padding: '16px 24px' }}>Reg No</th>}
                        {activeTab === 'profileUpdateRequests' && <th style={{ padding: '16px 24px' }}>Requested Changes</th>}
                        {activeTab === 'profileUpdateRequests' && <th style={{ padding: '16px 24px' }}>Submitted</th>}
                        {activeTab === 'leaderboard' && <th style={{ padding: '16px 24px' }}>Reg No</th>}
                        {activeTab === 'leaderboard' && <th style={{ padding: '16px 24px' }}>Month Points</th>}
                        {activeTab === 'leaderboard' && <th style={{ padding: '16px 24px' }}>Total Points</th>}
                        {activeTab === 'contacts' && <th style={{ padding: '16px 24px' }}>Email</th>}
                        {activeTab === 'contacts' && <th style={{ padding: '16px 24px' }}>Message</th>}
                        {activeTab === 'contacts' && <th style={{ padding: '16px 24px' }}>Read</th>}
                        {activeTab !== 'leaderboard' && <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedData.map((item) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td style={{ padding: '16px 24px', fontWeight: 500 }}>
                            {item.title || item.name || item.memberName || item.subject || 'Unknown'}
                            {activeTab === 'profileUpdateRequests' && item.memberEmail && (
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 400 }}>{item.memberEmail}</div>
                            )}
                            {activeTab === 'projects' && (item.submittedByEmail || item.submittedByName) && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 400, marginTop: '2px' }}>
                                Submitter: {item.submittedByName || ''} {item.submittedByEmail ? `<${item.submittedByEmail}>` : ''}
                              </div>
                            )}
                            {activeTab === 'blogs' && (item.author || item.readTime) && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 400, marginTop: '2px' }}>
                                By {item.author || 'Anonymous'}{item.readTime ? ` • ${item.readTime}` : ''}
                              </div>
                            )}
                          </td>
                          {activeTab === 'events' && <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>{item.date}</td>}
                          {activeTab === 'events' && <td style={{ padding: '16px 24px' }}><span className="badge badge-green">{item.type || 'Solo'}</span></td>}
                          {activeTab === 'events' && <td style={{ padding: '16px 24px' }}><span className="badge badge-yellow">{item.mode || 'Intra-College'}</span></td>}
                          {activeTab === 'events' && (
                            <td style={{ padding: '16px 24px' }}>
                              <span className={item.status === 'live' || item.status === 'ongoing' ? 'badge badge-accent' : item.status === 'completed' || item.status === 'past' ? 'badge badge-muted' : 'badge badge-blue'}>
                                {item.status === 'live' || item.status === 'ongoing' ? '🔴 Live' : item.status === 'completed' || item.status === 'past' ? 'Completed' : 'Upcoming'}
                              </span>
                            </td>
                          )}
                          {activeTab === 'events' && (
                            <td style={{ padding: '16px 24px' }}>
                              <button
                                onClick={() => handleOpenRegistrationsModal(item)}
                                style={{
                                  background: 'var(--accent-glow)',
                                  border: '1px solid var(--accent)',
                                  color: 'var(--accent)',
                                  padding: '6px 12px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: '0.85rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}
                              >
                                <FaUsers /> {eventRegCounts[item.id] ?? 0} {item.type === 'Team' ? 'Teams' : 'Registered'}
                              </button>
                            </td>
                          )}
                          {activeTab === 'projects' && (
                            <td
                              onClick={() => setViewingDetailItem({ ...item, _type: 'projects' })}
                              title="Click to view full description & details"
                              style={{
                                padding: '16px 24px',
                                maxWidth: '320px',
                                cursor: 'pointer',
                                userSelect: 'none'
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  color: 'var(--text-muted)',
                                  transition: 'all 0.2s ease',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  margin: '-4px -8px'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = 'var(--text-primary)';
                                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = 'var(--text-muted)';
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <span
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    flex: 1
                                  }}
                                >
                                  {item.description || '—'}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    color: 'var(--accent)',
                                    background: 'var(--accent-glow)',
                                    border: '1px solid rgba(0, 255, 136, 0.3)',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    fontWeight: 600
                                  }}
                                >
                                  Open ↗
                                </span>
                              </div>
                            </td>
                          )}
                          {activeTab === 'blogs' && (
                            <td
                              onClick={() => handleOpenBlogInspection(item)}
                              title="Click to view article excerpt & verification details"
                              style={{
                                padding: '16px 24px',
                                maxWidth: '240px',
                                cursor: 'pointer',
                                userSelect: 'none'
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  color: 'var(--text-muted)',
                                  transition: 'all 0.2s ease',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  margin: '-4px -8px'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = 'var(--text-primary)';
                                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = 'var(--text-muted)';
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <span
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    flex: 1
                                  }}
                                >
                                  {item.excerpt || item.description || '—'}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    color: 'var(--accent)',
                                    background: 'var(--accent-glow)',
                                    border: '1px solid rgba(0, 255, 136, 0.3)',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    fontWeight: 600
                                  }}
                                >
                                  Open ↗
                                </span>
                              </div>
                            </td>
                          )}
                          {activeTab === 'blogs' && (
                            <td style={{ padding: '16px 24px', maxWidth: '280px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    flex: 1,
                                    fontSize: '0.85rem',
                                    color: item.content ? 'var(--text-secondary)' : 'var(--text-dim)'
                                  }}
                                  title={item.content ? item.content.slice(0, 200) : 'No content loaded yet'}
                                >
                                  {item.content ? item.content.replace(/[#*`_~-]/g, '').slice(0, 35) + '...' : '(No content)'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenBlogInspection(item)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    color: 'var(--accent)',
                                    background: 'var(--accent-glow)',
                                    border: '1px solid rgba(0, 255, 136, 0.35)',
                                    padding: '4px 9px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    transition: 'all 0.2s'
                                  }}
                                  title="Inspect full uploaded content to verify before approving"
                                >
                                  <FaFileAlt style={{ fontSize: '0.75rem' }} /> Verify Content ↗
                                </button>
                              </div>
                            </td>
                          )}
                          {(activeTab === 'projects' || activeTab === 'blogs') && (
                            <td style={{ padding: '16px 24px' }}>
                              <span className={item.status === 'approved' ? 'badge badge-green' : item.status === 'rejected' ? 'badge badge-red' : 'badge badge-yellow'}>
                                {item.status === 'approved' ? 'Approved' : item.status === 'rejected' ? 'Rejected' : 'Pending Verification'}
                              </span>
                              {activeTab === 'projects' && item.status === 'rejected' && item.rejectionReason && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '4px', maxWidth: '200px', lineHeight: 1.4 }}>
                                  Reason: {item.rejectionReason}
                                </div>
                              )}
                            </td>
                          )}
                          {activeTab === 'projects' && (
                            <td style={{ padding: '16px 24px' }}>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {item.githubLink ? (
                                  <a href={item.githubLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.8rem', textDecoration: 'underline' }}>
                                    GitHub
                                  </a>
                                ) : null}
                                {item.liveLink ? (
                                  <a href={item.liveLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)', fontSize: '0.8rem', textDecoration: 'underline' }}>
                                    Live
                                  </a>
                                ) : null}
                                {!item.githubLink && !item.liveLink && (
                                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>—</span>
                                )}
                              </div>
                            </td>
                          )}
                          {activeTab === 'members' && (
                            <td style={{ padding: '16px 24px' }}>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent)', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '6px', fontSize: '0.85rem' }}>
                                {item.registrationNumber || '—'}
                              </span>
                            </td>
                          )}
                          {activeTab === 'members' && <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>{item.email}</td>}
                          {activeTab === 'members' && <td style={{ padding: '16px 24px' }}><span className={item.status === 'approved' ? 'badge badge-green' : 'badge badge-yellow'}>{item.status || 'pending'}</span></td>}
                      
                      {/* Profile Updates specific cells */}
                      {activeTab === 'profileUpdateRequests' && (
                        <td style={{ padding: '16px 24px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent)', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '6px', fontSize: '0.85rem' }}>
                            {item.registrationNumber || '—'}
                          </span>
                        </td>
                      )}
                      {activeTab === 'profileUpdateRequests' && (
                        <td style={{ padding: '16px 24px' }}>
                          <div style={{ fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '300px' }}>
                            {item.requestedData?.name && item.requestedData.name !== item.currentData?.name && (
                              <div><span style={{ color: 'var(--text-dim)' }}>Name:</span> <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{item.currentData?.name || 'Empty'}</span> → <strong style={{ color: 'var(--accent)' }}>{item.requestedData.name}</strong></div>
                            )}
                            {item.requestedData?.bio !== item.currentData?.bio && (
                              <div><span style={{ color: 'var(--text-dim)' }}>Bio:</span> <span style={{ color: 'var(--text-primary)' }}>&quot;{item.requestedData?.bio ? item.requestedData.bio.slice(0, 35) + '...' : '(cleared)'}&quot;</span></div>
                            )}
                            {item.requestedData?.image !== item.currentData?.image && (
                              <div><span style={{ color: 'var(--text-dim)' }}>Image:</span> <span style={{ color: 'var(--info)' }}>New Avatar URL</span></div>
                            )}
                            {item.requestedData?.github !== item.currentData?.github && (
                              <div><span style={{ color: 'var(--text-dim)' }}>GitHub:</span> <span style={{ color: 'var(--accent)' }}>{item.requestedData?.github || '(cleared)'}</span></div>
                            )}
                            {item.requestedData?.linkedin !== item.currentData?.linkedin && (
                              <div><span style={{ color: 'var(--text-dim)' }}>LinkedIn:</span> <span style={{ color: 'var(--info)' }}>{item.requestedData?.linkedin || '(cleared)'}</span></div>
                            )}
                          </div>
                        </td>
                      )}
                      {activeTab === 'profileUpdateRequests' && (
                        <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                        </td>
                      )}
                      {activeTab === 'profileUpdateRequests' && (
                        <td style={{ padding: '16px 24px' }}>
                          <span className={item.status === 'approved' ? 'badge badge-green' : item.status === 'rejected' ? 'badge badge-red' : 'badge badge-yellow'}>
                            {item.status || 'pending'}
                          </span>
                        </td>
                      )}

                      {activeTab === 'leaderboard' && (
                        <td style={{ padding: '16px 24px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent)', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '6px', fontSize: '0.85rem' }}>
                            {item.registrationNumber || '—'}
                          </span>
                        </td>
                      )}
                      {activeTab === 'leaderboard' && <td style={{ padding: '16px 24px', fontWeight: 700, color: 'var(--accent)' }}>{(item.currentMonthPoints ?? 0).toLocaleString()} XP</td>}
                      {activeTab === 'leaderboard' && <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>{(item.totalPoints ?? 0).toLocaleString()} XP</td>}
                      {activeTab === 'contacts' && <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>{item.email}</td>}
                      {activeTab === 'contacts' && (
                        <td
                          onClick={() => setViewingDetailItem({ ...item, title: `Message from ${item.name || item.email}`, _type: 'contacts' })}
                          title="Click to view full message"
                          style={{
                            padding: '16px 24px',
                            maxWidth: '280px',
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              color: 'var(--text-muted)',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              margin: '-4px -8px',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--text-primary)';
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--text-muted)';
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                              {item.message}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid rgba(0, 255, 136, 0.3)', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 600 }}>
                              Open ↗
                            </span>
                          </div>
                        </td>
                      )}
                      {activeTab === 'contacts' && (
                        <td style={{ padding: '16px 24px' }}>
                          <button
                            onClick={() => handleToggleRead(item)}
                            style={{ background: 'none', border: 'none', color: item.read ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem' }}
                            title={item.read ? 'Mark as Unread' : 'Mark as Read'}
                          >
                            {item.read ? <FaCheckCircle /> : <FaTimes />}
                          </button>
                        </td>
                      )}
                      {activeTab !== 'leaderboard' && (
                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                          {activeTab === 'projects' && (
                            <>
                              {item.status !== 'approved' && (
                                <button
                                  onClick={() => handleApproveProject(item.id)}
                                  style={{
                                    background: 'rgba(0, 255, 136, 0.15)',
                                    border: '1px solid var(--accent)',
                                    color: 'var(--accent)',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.8rem',
                                    marginRight: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                  title="Approve Project (make visible to public & member)"
                                >
                                  <FaCheckCircle /> Approve
                                </button>
                              )}
                              {item.status !== 'rejected' && (
                                <button
                                  onClick={() => handleRejectProject(item.id)}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid var(--danger)',
                                    color: 'var(--danger)',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.8rem',
                                    marginRight: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                  title={item.status === 'approved' ? 'Revoke Approval / Reject' : 'Reject Project'}
                                >
                                  <FaTimes /> {item.status === 'approved' ? 'Revoke' : 'Reject'}
                                </button>
                              )}
                            </>
                          )}
                          {activeTab === 'blogs' && (
                            <button
                              onClick={() => handleOpenBlogInspection(item)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', marginRight: '12px', fontSize: '1.1rem' }}
                              title="Verify Article Content & Details"
                            >
                              <FaEye />
                            </button>
                          )}
                          {activeTab === 'blogs' && item.status !== 'approved' && (
                            <button
                              onClick={() => handleApproveBlog(item.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', marginRight: '16px', fontSize: '1.1rem' }}
                              title="Approve Article"
                            >
                              <FaCheckCircle />
                            </button>
                          )}
                          {activeTab === 'members' && item.status !== 'approved' && (
                            <button
                              onClick={() => handleApproveMember(item.id)}
                              disabled={approvingId === item.id}
                              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', marginRight: '16px', fontSize: '1.1rem' }}
                              title="Approve Member"
                            >
                              <FaUserCheck /> {approvingId === item.id ? 'Approving...' : ''}
                            </button>
                          )}
                          {activeTab === 'profileUpdateRequests' && item.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApproveProfileUpdate(item)}
                                style={{
                                  background: 'rgba(0, 255, 136, 0.15)',
                                  border: '1px solid var(--accent)',
                                  color: 'var(--accent)',
                                  padding: '6px 12px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  marginRight: '8px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Approve Changes"
                              >
                                <FaCheckCircle /> Approve
                              </button>
                              <button
                                onClick={() => handleRejectProfileUpdate(item)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  border: '1px solid var(--danger)',
                                  color: 'var(--danger)',
                                  padding: '6px 12px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  marginRight: '8px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Reject Changes"
                              >
                                <FaTimes /> Reject
                              </button>
                            </>
                          )}
                          {activeTab !== 'contacts' && activeTab !== 'profileUpdateRequests' && (
                            <button
                              onClick={() => handleOpenEditModal(item)}
                              style={{ background: 'none', border: 'none', color: 'var(--info)', cursor: 'pointer', marginRight: '16px', fontSize: '1.1rem' }}
                              title="Edit Item"
                            >
                              <FaEdit />
                            </button>
                          )}
                          <button
                            onClick={() => confirmDelete(item.id, item.title || item.name || item.memberName || item.subject || 'this item', activeTab === 'leaderboard' ? 'members' : activeTab)}
                            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem' }}
                            title="Delete Item"
                          >
                            <FaTrash />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', color: 'var(--border-light)', marginBottom: '16px' }}>
                {tabs.find(t => t.id === activeTab)?.icon}
              </div>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '8px' }}>No documents found</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                {activeTab === 'profileUpdateRequests' ? 'No profile update requests at this time.' : `Get started by adding a new ${activeTab.slice(0, -1)}.`}
              </p>
            </div>
          )}
        </div>
      );
    })()}
  </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Confirm Deletion">
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: 'var(--text-primary)', marginBottom: '16px', fontSize: '1rem', lineHeight: '1.5' }}>
            Are you sure you want to permanently delete <strong style={{ color: 'var(--danger)' }}>&quot;{deleteTarget?.name}&quot;</strong> from <code style={{ color: 'var(--accent)' }}>{deleteTarget?.collectionName}</code>?
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '24px' }}>
            {deleteTarget?.collectionName === 'members'
              ? 'This action cannot be undone. Their member profile and Firebase Authentication login account will both be permanently deleted.'
              : 'This action cannot be undone. Associated data and subcollections will also be deleted.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
              style={{ padding: '10px 20px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff', padding: '10px 20px' }}
            >
              {isDeleting ? 'Deleting...' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Admin Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={`${editingItem ? 'Edit' : 'Add'} ${activeTab.slice(0, -1)}`}>
        <form onSubmit={handleFormSubmit}>
          {/* EVENTS FORM */}
          {activeTab === 'events' && (
            <>
              <div className="form-group">
                <label className="form-label">Event Title *</label>
                <input required type="text" className="form-input" placeholder="e.g. CodeSprint 2026" value={formData.title || ''} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Description *</label>
                <textarea required className="form-input" rows={3} placeholder="Event overview and guidelines..." value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Event Thumbnail (Image URL)</label>
                <input type="url" className="form-input" placeholder="https://images.unsplash.com/... or public image URL" value={formData.image || ''} onChange={(e) => setFormData({ ...formData, image: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input required type="date" className="form-input" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Venue *</label>
                  <input required type="text" className="form-input" placeholder="e.g. Lab 3 / Seminar Hall" value={formData.venue || ''} onChange={(e) => setFormData({ ...formData, venue: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={formData.type || 'Solo'} onChange={(e) => setFormData({ ...formData, type: e.target.value })}>
                    <option value="Solo">Solo</option>
                    <option value="Team">Team</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select className="form-input" value={formData.mode || 'Intra-College'} onChange={(e) => setFormData({ ...formData, mode: e.target.value })}>
                    <option value="Intra-College">Intra-College</option>
                    <option value="Open">Open</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-input" value={formData.status || 'upcoming'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </>
          )}

          {/* PROJECTS FORM */}
          {activeTab === 'projects' && (
            <>
              <div className="form-group">
                <label className="form-label">Project Title *</label>
                <input required type="text" className="form-input" value={formData.title || ''} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Verification Status *</label>
                <select className="form-input" value={formData.status || 'pending'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  <option value="pending">Pending Verification</option>
                  <option value="approved">Approved (Visible to Public & Member)</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Description *</label>
                <textarea required className="form-input" rows={3} value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Tech Stack (comma separated) *</label>
                <input required type="text" className="form-input" placeholder="Next.js, Tailwind CSS, TypeScript" value={formData.techStack || ''} onChange={(e) => setFormData({ ...formData, techStack: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">GitHub URL</label>
                  <input type="url" className="form-input" placeholder="https://github.com/..." value={formData.githubLink || ''} onChange={(e) => setFormData({ ...formData, githubLink: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Live Link</label>
                  <input type="url" className="form-input" placeholder="https://..." value={formData.liveLink || ''} onChange={(e) => setFormData({ ...formData, liveLink: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Thumbnail Image URL</label>
                <input type="url" className="form-input" placeholder="https://images.unsplash.com/..." value={formData.image || ''} onChange={(e) => setFormData({ ...formData, image: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Contributors (comma separated)</label>
                <input type="text" className="form-input" placeholder="Jane Doe, John Smith" value={formData.contributors || ''} onChange={(e) => setFormData({ ...formData, contributors: e.target.value })} />
              </div>
            </>
          )}

          {/* BLOGS FORM */}
          {activeTab === 'blogs' && (
            <>
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input required type="text" className="form-input" value={formData.title || ''} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Author *</label>
                  <input required type="text" className="form-input" value={formData.author || ''} onChange={(e) => setFormData({ ...formData, author: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Read Time *</label>
                  <input required type="text" className="form-input" placeholder="5 min read" value={formData.readTime || ''} onChange={(e) => setFormData({ ...formData, readTime: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Excerpt *</label>
                <textarea required className="form-input" rows={2} value={formData.excerpt || ''} onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Content (Markdown) *</label>
                <textarea required className="form-input" rows={5} value={formData.content || ''} onChange={(e) => setFormData({ ...formData, content: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-input" value={formData.status || 'pending'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
            </>
          )}

          {/* MEMBERS FORM */}
          {activeTab === 'members' && (
            <>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input required type="text" className="form-input" value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Registration Number (Unique ID) *</label>
                <input required type="text" className="form-input" placeholder="e.g. 22NIELIT101" value={formData.registrationNumber || ''} onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input required type="email" className="form-input" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Profile Image URL</label>
                <input type="url" className="form-input" value={formData.image || ''} onChange={(e) => setFormData({ ...formData, image: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Bio</label>
                <textarea className="form-input" rows={2} value={formData.bio || ''} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">GitHub URL</label>
                  <input type="url" className="form-input" value={formData.github || ''} onChange={(e) => setFormData({ ...formData, github: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">LinkedIn URL</label>
                  <input type="url" className="form-input" value={formData.linkedin || ''} onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {/* LEADERBOARD FORM */}
          {activeTab === 'leaderboard' && (
            <>
              <div className="form-group">
                <label className="form-label">Coder Name *</label>
                <input required type="text" className="form-input" value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Codeforces Rating</label>
                  <input type="number" className="form-input" value={formData.codeforcesRating || 0} onChange={(e) => setFormData({ ...formData, codeforcesRating: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">LeetCode Solved</label>
                  <input type="number" className="form-input" value={formData.leetcodeProblems || 0} onChange={(e) => setFormData({ ...formData, leetcodeProblems: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">CodeChef Stars (1-5)</label>
                  <input type="number" min="0" max="5" className="form-input" value={formData.codechefStars || 0} onChange={(e) => setFormData({ ...formData, codechefStars: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Total Score *</label>
                  <input required type="number" className="form-input" value={formData.totalScore || 0} onChange={(e) => setFormData({ ...formData, totalScore: e.target.value })} />
                </div>
              </div>
            </>
          )}

          <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '16px', marginTop: '16px' }} disabled={formLoading}>
            {formLoading ? 'Saving...' : editingItem ? 'Update' : 'Create'}
          </button>
        </form>
      </Modal>

      {/* Event Registrations & Scoring Modal */}
      <Modal
        isOpen={!!selectedEventForRegs}
        onClose={() => setSelectedEventForRegs(null)}
        title={`Registrations: ${selectedEventForRegs?.title || ''}`}
      >
        {selectedEventForRegs && (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <span className="badge badge-green">Type: {selectedEventForRegs.type || 'Solo'}</span>
              <span className="badge badge-yellow">Mode: {selectedEventForRegs.mode || 'Intra-College'}</span>
              <span className={selectedEventForRegs.status === 'live' || selectedEventForRegs.status === 'ongoing' ? 'badge badge-accent' : selectedEventForRegs.status === 'completed' || selectedEventForRegs.status === 'past' ? 'badge badge-muted' : 'badge badge-blue'}>
                Status: {selectedEventForRegs.status}
              </span>
            </div>

            {selectedEventForRegs.status === 'completed' && selectedEventForRegs.mode !== 'Open' && (
              <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--info)', color: 'var(--info)', padding: '12px 16px', borderRadius: '10px', marginBottom: '20px', fontSize: '0.9rem' }}>
                ℹ️ Event is completed. Assign points (out of 100) below — points go to each winner's registration number (for teams, every team member receives the points).
              </div>
            )}

            {/* Position picker / Set Winners for ALL completed events */}
            {selectedEventForRegs.status === 'completed' && (
              <div style={{ background: 'rgba(250, 204, 21, 0.08)', border: '1px solid var(--warning, #facc15)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <FaMedal style={{ color: 'var(--gold)', fontSize: '1.1rem' }} />
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Declare Event Winners (1st, 2nd, 3rd)</span>
                </div>

                {/* Approved/eligible registrations for position selection */}
                {(() => {
                  const eligibleRegs = eventRegs.filter(r => 
                    r.status === 'approved' || 
                    (!r.status && selectedEventForRegs.mode === 'Intra-College') || 
                    (selectedEventForRegs.mode === 'Intra-College' && r.status !== 'rejected')
                  );
                  if (eligibleRegs.length === 0) {
                    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No registrations found for this event yet.</p>;
                  }

                  const getLabel = (r: any) => r.type === 'Team' ? `Team: ${r.teamName || r.name}` : r.name;
                  const positions: Array<{ key: 'first' | 'second' | 'third'; label: string; emoji: string; required: boolean }> = [
                    { key: 'first', label: '1st Place', emoji: '🥇', required: true },
                    { key: 'second', label: '2nd Place', emoji: '🥈', required: false },
                    { key: 'third', label: '3rd Place', emoji: '🥉', required: false },
                  ];

                  return (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                        {positions.map(({ key, label, emoji, required }) => (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '1.2rem', minWidth: 28 }}>{emoji}</span>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 90 }}>{label}{required ? ' *' : ''}</label>
                            <select
                              className="form-input"
                              style={{ flex: 1, height: '36px', padding: '4px 10px', fontSize: '0.85rem' }}
                              value={openResultDraft[key]}
                              onChange={(e) => setOpenResultDraft(prev => ({ ...prev, [key]: e.target.value }))}
                            >
                              <option value="">— {required ? 'Select winner' : 'None (optional)'} —</option>
                              {eligibleRegs.map(r => (
                                <option key={r.id} value={r.id} disabled={
                                  (key !== 'first' && openResultDraft.first === r.id) ||
                                  (key !== 'second' && openResultDraft.second === r.id) ||
                                  (key !== 'third' && openResultDraft.third === r.id)
                                }>
                                  {getLabel(r)} {typeof r.score === 'number' ? `(${r.score} pts)` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={handleSaveOpenResults}
                        disabled={savingOpenResults || !openResultDraft.first}
                        className="btn-primary"
                        style={{ padding: '8px 20px', fontSize: '0.85rem' }}
                      >
                        {savingOpenResults ? 'Saving...' : '💾 Save Results'}
                      </button>
                      {(selectedEventForRegs.openResults?.first || selectedEventForRegs.results?.first) && (
                        <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--accent)' }}>
                          ✓ Results saved — 1st: {(selectedEventForRegs.openResults?.first || selectedEventForRegs.results?.first).name}
                          {(selectedEventForRegs.openResults?.second || selectedEventForRegs.results?.second) && ` · 2nd: ${(selectedEventForRegs.openResults?.second || selectedEventForRegs.results?.second).name}`}
                          {(selectedEventForRegs.openResults?.third || selectedEventForRegs.results?.third) && ` · 3rd: ${(selectedEventForRegs.openResults?.third || selectedEventForRegs.results?.third).name}`}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {regsLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading registrations...</div>
            ) : eventRegs.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No participants registered for this event yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                {eventRegs.map((reg) => (
                  <div
                    key={reg.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      borderRadius: '12px',
                      border: '1px solid var(--border)',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                            {reg.type === 'Team' ? `Team: ${reg.teamName}` : reg.name}
                          </h4>
                          <span className={reg.status === 'approved' ? 'badge badge-green' : reg.status === 'rejected' ? 'badge badge-red' : 'badge badge-yellow'}>
                            {reg.status || (reg.mode === 'Intra-College' ? 'approved' : 'pending')}
                          </span>
                          {typeof reg.score === 'number' && (
                            <span className="badge badge-accent">⭐ {reg.score}/100</span>
                          )}
                        </div>
                        {reg.type === 'Team' && (
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Leader: <strong>{reg.teamLeader}</strong> • Members: {reg.memberCount || reg.members?.length || 0}
                            {reg.college && ` • College: ${reg.college}`}
                          </p>
                        )}
                        {reg.type !== 'Team' && (
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Reg No: <strong>{reg.regNumber}</strong> • Branch: {reg.branch} • Year: {reg.year} • Sem: {reg.semester}
                            {reg.college && ` • College: ${reg.college}`}
                          </p>
                        )}
                      </div>

                      {/* Admin Verification for Open mode — only shown when status is pending */}
                      {reg.mode === 'Open' && (!reg.status || reg.status === 'pending') && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleUpdateRegStatus(reg.id, 'approved')}
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleUpdateRegStatus(reg.id, 'rejected')}
                            style={{ background: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Team Members List Breakdown if Team */}
                    {reg.type === 'Team' && Array.isArray(reg.members) && reg.members.length > 0 && (
                      <div style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>Team Members:</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                          {reg.members.map((m: any, mIdx: number) => (
                            <div key={mIdx} style={{ fontSize: '0.8rem', color: 'var(--text-primary)', background: 'var(--bg-card)', padding: '6px 10px', borderRadius: '6px' }}>
                              <strong>{m.name || `Member ${mIdx + 1}`}</strong> ({m.regNumber || 'N/A'})
                              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{m.branch} - Yr {m.year}, Sem {m.semester}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scoring Section (when event is completed) — Intra-College only */}
                    {selectedEventForRegs.status === 'completed' && selectedEventForRegs.mode !== 'Open' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Assign Points (0 - 100):</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="e.g. 85"
                          className="form-input"
                          style={{ width: '100px', height: '36px', padding: '4px 10px', fontSize: '0.9rem' }}
                          value={scoringScores[reg.id] !== undefined ? scoringScores[reg.id] : ''}
                          onChange={(e) => setScoringScores({ ...scoringScores, [reg.id]: Number(e.target.value) })}
                        />
                        <button
                          onClick={() => handleSaveScore(reg.id)}
                          disabled={savingScoreId === reg.id}
                          className="btn-primary"
                          style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                        >
                          {savingScoreId === reg.id ? 'Saving...' : 'Save Points'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Item Details / Full Description & Content Inspection Modal */}
      <Modal
        isOpen={!!viewingDetailItem}
        onClose={() => setViewingDetailItem(null)}
        title={viewingDetailItem?.title || viewingDetailItem?.name || 'Item Details'}
        maxWidth={viewingDetailItem?._type === 'blogs' ? '820px' : '620px'}
      >
        {viewingDetailItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Header Status & Metadata Badges */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {viewingDetailItem._type === 'projects' && (
                <span className={viewingDetailItem.status === 'approved' ? 'badge badge-green' : viewingDetailItem.status === 'rejected' ? 'badge badge-red' : 'badge badge-yellow'}>
                  Status: {viewingDetailItem.status === 'approved' ? 'Approved' : viewingDetailItem.status === 'rejected' ? 'Rejected' : 'Pending Verification'}
                </span>
              )}
              {viewingDetailItem._type === 'blogs' && (
                <span className={viewingDetailItem.status === 'approved' ? 'badge badge-green' : 'badge badge-yellow'}>
                  Status: {viewingDetailItem.status === 'approved' ? 'Approved' : 'Pending Verification'}
                </span>
              )}
              {viewingDetailItem._type === 'blogs' && viewingDetailItem.author && (
                <span className="badge badge-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <FaUser style={{ fontSize: '0.75rem' }} /> {viewingDetailItem.author}
                </span>
              )}
              {viewingDetailItem._type === 'blogs' && viewingDetailItem.readTime && (
                <span className="badge badge-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <FaClock style={{ fontSize: '0.75rem' }} /> {viewingDetailItem.readTime}
                </span>
              )}
              {viewingDetailItem.category && (
                <span className="badge badge-blue">Category: {viewingDetailItem.category}</span>
              )}
              {viewingDetailItem.createdAt && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  Submitted: {new Date(viewingDetailItem.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {viewingDetailItem._type === 'blogs' && viewingDetailItem.slug && (
                <a
                  href={`/blog/${viewingDetailItem.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.75rem',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    background: 'var(--accent-glow)',
                    padding: '3px 9px',
                    borderRadius: '6px',
                    border: '1px solid rgba(0, 255, 136, 0.3)',
                    marginLeft: 'auto',
                    fontWeight: 600
                  }}
                  title="Preview article on the site (admins can view pending articles)"
                >
                  Live Preview <FaExternalLinkAlt style={{ fontSize: '0.7rem' }} />
                </a>
              )}
            </div>

            {/* Thumbnail Preview for Blogs */}
            {viewingDetailItem._type === 'blogs' && viewingDetailItem.thumbnail && (
              <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)', maxHeight: '160px' }}>
                <img
                  src={viewingDetailItem.thumbnail}
                  alt={viewingDetailItem.title}
                  style={{ width: '100%', height: '160px', objectFit: 'cover' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Submitter Info Card (for projects) */}
            {viewingDetailItem._type === 'projects' && (viewingDetailItem.submittedByName || viewingDetailItem.submittedByEmail || viewingDetailItem.registrationNumber) && (
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '6px' }}>
                  Submitter Information
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.9rem' }}>
                  {viewingDetailItem.submittedByName && (
                    <div><strong style={{ color: 'var(--text-primary)' }}>{viewingDetailItem.submittedByName}</strong></div>
                  )}
                  {viewingDetailItem.submittedByEmail && (
                    <div style={{ color: 'var(--text-muted)' }}>✉️ {viewingDetailItem.submittedByEmail}</div>
                  )}
                  {viewingDetailItem.registrationNumber && (
                    <div style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>ID: {viewingDetailItem.registrationNumber}</div>
                  )}
                </div>
              </div>
            )}

            {/* Rejection notice if rejected */}
            {viewingDetailItem._type === 'projects' && viewingDetailItem.status === 'rejected' && viewingDetailItem.rejectionReason && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '10px', padding: '12px 16px', color: 'var(--danger)', fontSize: '0.88rem' }}>
                <strong>Rejection Reason:</strong> {viewingDetailItem.rejectionReason}
              </div>
            )}

            {/* Excerpt Box for Blogs */}
            {viewingDetailItem._type === 'blogs' && (
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '6px', fontWeight: 600 }}>
                  Short Excerpt / Summary
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                  {viewingDetailItem.excerpt || viewingDetailItem.description || 'No excerpt provided.'}
                </div>
              </div>
            )}

            {/* Uploaded Content (Article Body) for Blogs */}
            {viewingDetailItem._type === 'blogs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Uploaded Article Content
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid rgba(0, 255, 136, 0.3)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      Main Verification
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {viewingDetailItem.content ? `${viewingDetailItem.content.trim().split(/\s+/).filter(Boolean).length} words • ${viewingDetailItem.content.length} chars` : '0 words'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* View Mode Switcher */}
                    <div style={{ display: 'inline-flex', background: 'var(--bg-secondary)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <button
                        type="button"
                        onClick={() => setBlogContentTab('preview')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: blogContentTab === 'preview' ? 'var(--accent)' : 'transparent',
                          color: blogContentTab === 'preview' ? '#000' : 'var(--text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <FaEye style={{ fontSize: '0.75rem' }} /> Formatted Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setBlogContentTab('raw')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: blogContentTab === 'raw' ? 'var(--accent)' : 'transparent',
                          color: blogContentTab === 'raw' ? '#000' : 'var(--text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <FaFileAlt style={{ fontSize: '0.75rem' }} /> Raw Markdown
                      </button>
                    </div>

                    {/* Refresh from Firebase Button */}
                    <button
                      type="button"
                      onClick={() => handleFetchLiveBlogContent(viewingDetailItem.id)}
                      disabled={fetchingBlogContent}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--accent)',
                        background: 'rgba(0, 255, 136, 0.1)',
                        border: '1px solid rgba(0, 255, 136, 0.3)',
                        padding: '5px 10px',
                        borderRadius: '8px',
                        cursor: fetchingBlogContent ? 'wait' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                      title="Fetch latest document content directly from Firebase Firestore"
                    >
                      <FaSyncAlt style={{ fontSize: '0.7rem', animation: fetchingBlogContent ? 'spin 1s linear infinite' : 'none' }} />
                      {fetchingBlogContent ? 'Fetching...' : 'Fetch from Firebase'}
                    </button>

                    {/* Copy Button */}
                    {viewingDetailItem.content && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(viewingDetailItem.content);
                          toast.success('Article content copied to clipboard!');
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          padding: '5px 9px',
                          borderRadius: '8px',
                          cursor: 'pointer'
                        }}
                        title="Copy raw markdown content"
                      >
                        <FaCopy style={{ fontSize: '0.7rem' }} /> Copy
                      </button>
                    )}
                  </div>
                </div>

                {/* Content Box */}
                {fetchingBlogContent ? (
                  <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    <FaSyncAlt style={{ animation: 'spin 1s linear infinite', marginBottom: '8px', fontSize: '1.2rem', color: 'var(--accent)' }} />
                    <div>Fetching article content from Firebase...</div>
                  </div>
                ) : viewingDetailItem.content ? (
                  blogContentTab === 'preview' ? (
                    <div
                      style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '20px',
                        maxHeight: '420px',
                        overflowY: 'auto',
                        lineHeight: 1.7
                      }}
                    >
                      {renderBlogContentMarkdown(viewingDetailItem.content)}
                    </div>
                  ) : (
                    <pre
                      style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '16px',
                        maxHeight: '420px',
                        overflowY: 'auto',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0
                      }}
                    >
                      {viewingDetailItem.content}
                    </pre>
                  )
                ) : (
                  <div
                    style={{
                      background: 'rgba(234, 179, 8, 0.08)',
                      border: '1px dashed rgba(234, 179, 8, 0.4)',
                      borderRadius: '10px',
                      padding: '24px',
                      textAlign: 'center'
                    }}
                  >
                    <p style={{ margin: '0 0 12px 0', color: 'var(--warning)', fontSize: '0.9rem' }}>
                      ⚠️ No content found in this Firebase document.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleFetchLiveBlogContent(viewingDetailItem.id)}
                      className="btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                    >
                      <FaSyncAlt /> Try Fetching from Firebase
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Full Description Box (for contacts & projects) */}
            {viewingDetailItem._type !== 'blogs' && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {viewingDetailItem._type === 'contacts' ? 'Full Message:' : 'Full Description:'}
                </div>
                <div
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '16px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.92rem',
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '350px',
                    overflowY: 'auto'
                  }}
                >
                  {viewingDetailItem.description || viewingDetailItem.message || 'No description provided.'}
                </div>
              </div>
            )}

            {/* Tech Stack / Tags */}
            {viewingDetailItem.tags && viewingDetailItem.tags.length > 0 && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Tags:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {viewingDetailItem.tags.map((t: string, i: number) => (
                    <span
                      key={i}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace'
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Project Links (GitHub & Live URL) */}
            {viewingDetailItem._type === 'projects' && (viewingDetailItem.githubLink || viewingDetailItem.liveLink) && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Project Links:
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {viewingDetailItem.githubLink && (
                    <a
                      href={viewingDetailItem.githubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.85rem',
                        padding: '8px 14px',
                        textDecoration: 'none'
                      }}
                    >
                      <FaGithub /> GitHub Repository <FaExternalLinkAlt style={{ fontSize: '0.75rem' }} />
                    </a>
                  )}
                  {viewingDetailItem.liveLink && (
                    <a
                      href={viewingDetailItem.liveLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.85rem',
                        padding: '8px 14px',
                        textDecoration: 'none'
                      }}
                    >
                      <FaExternalLinkAlt style={{ fontSize: '0.75rem' }} /> Open Live Demo
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Admin Action Buttons Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '16px',
                borderTop: '1px solid var(--border-light)',
                marginTop: '8px',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {viewingDetailItem._type === 'projects' && (
                  <>
                    {viewingDetailItem.status !== 'approved' && (
                      <button
                        onClick={() => handleApproveProject(viewingDetailItem.id)}
                        style={{
                          background: 'rgba(0, 255, 136, 0.15)',
                          border: '1px solid var(--accent)',
                          color: 'var(--accent)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <FaCheckCircle /> Approve Project
                      </button>
                    )}
                    {viewingDetailItem.status !== 'rejected' && (
                      <button
                        onClick={() => handleRejectProject(viewingDetailItem.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid var(--danger)',
                          color: 'var(--danger)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <FaTimes /> {viewingDetailItem.status === 'approved' ? 'Revoke Approval / Reject' : 'Reject Project'}
                      </button>
                    )}
                  </>
                )}
                {viewingDetailItem._type === 'blogs' && (
                  <>
                    {viewingDetailItem.status !== 'approved' && (
                      <button
                        onClick={() => {
                          handleApproveBlog(viewingDetailItem.id);
                          setViewingDetailItem((prev: any) => ({ ...prev, status: 'approved' }));
                        }}
                        style={{
                          background: 'rgba(0, 255, 136, 0.15)',
                          border: '1px solid var(--accent)',
                          color: 'var(--accent)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <FaCheckCircle /> Approve Article
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const itemToEdit = { ...viewingDetailItem };
                        setViewingDetailItem(null);
                        handleOpenEditModal(itemToEdit);
                      }}
                      className="btn-secondary"
                      style={{
                        padding: '8px 16px',
                        fontSize: '0.85rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <FaEdit /> Edit Article
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => setViewingDetailItem(null)}
                className="btn-secondary"
                style={{ padding: '8px 18px', fontSize: '0.85rem' }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}