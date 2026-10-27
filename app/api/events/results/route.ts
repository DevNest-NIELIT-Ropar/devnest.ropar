import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

// GET /api/events/results?eventId=...
// Public-safe event results endpoint using Admin SDK.
// Avoids Firestore security rule permissions issues on subcollection reads.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    const eventRef = adminDb.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();

    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventData = eventSnap.data() || {};
    const results = eventData.openResults || eventData.results || eventData.winners || null;

    // Check if event already has topPerformers saved
    let topPerformers = Array.isArray(eventData.topPerformers) ? eventData.topPerformers : [];

    // If topPerformers is not saved or empty, compute from registrations subcollection
    if (topPerformers.length === 0) {
      try {
        const regSnap = await eventRef.collection('registrations').get();
        const scored = regSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((r: any) => typeof r.score === 'number' && r.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 3)
          .map((r: any) => {
            const item: any = {
              id: r.id,
              name: r.type === 'Team' ? `Team: ${r.teamName || r.name}` : r.name,
              type: r.type || 'Solo',
              score: r.score
            };
            if (r.type === 'Team' && r.teamLeader) {
              item.teamLeader = r.teamLeader;
            }
            return item;
          });

        if (scored.length > 0) {
          topPerformers = scored;
          // Sync to event document for caching
          await eventRef.update({ topPerformers: scored }).catch(() => {});
        }
      } catch (subErr) {
        console.warn('Could not read registrations subcollection in results route:', subErr);
      }
    }

    return NextResponse.json({
      results,
      topPerformers
    });
  } catch (err: any) {
    console.error('Error in /api/events/results:', err);
    return NextResponse.json({ error: 'Failed to fetch event results' }, { status: 500 });
  }
}
