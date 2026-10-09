import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api.js';

/**
 * Starts a live web investigation and opens its results on Explore.
 * The server answers as soon as the run exists; Explore then follows the
 * run's progress through /web-search/:id/status.
 */
export function useInvestigate() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const investigate = useCallback(async (raw) => {
    const query = String(raw || '').trim();
    if (query.length < 2) {
      setError(new Error('Enter a claim, person, event or topic to investigate.'));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const run = await api.investigateWeb(query);
      navigate(`/explore?q=${encodeURIComponent(query)}&run=${run.searchRunId}`);
    } catch (err) {
      setError(err);
    } finally {
      setStarting(false);
    }
  }, [navigate]);

  return { investigate, starting, error };
}
