import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { api, ApiError, PollState } from '../utils/api';
import {
  getFirebaseUid,
  subscribeActivePollCloud,
  votePollCloud,
} from '../utils/cloudStore';
import { useAuth } from '../context/AuthContext';
import { getCachedPoll, hasCompletedInitialBootstrap, setFastPoll, subscribeFastStore } from '../utils/fastStore';

export const PollSection: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const [poll, setPoll] = useState<PollState | null>(() => getCachedPoll());
  const [cloudPoll, setCloudPoll] = useState<PollState | null>(null);
  const [loading, setLoading] = useState(() => !getCachedPoll());
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPoll = useCallback(async () => {
    try {
      const data = await api.getPoll();
      setPoll(data);
      setFastPoll(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التصويت.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubFast = subscribeFastStore(() => {
      const cached = getCachedPoll();
      if (cached) {
        setPoll(cached);
        setLoading(false);
      }
    });

    if (user?.id || (hasCompletedInitialBootstrap() && !getCachedPoll())) {
      void loadPoll();
    }

    const unsubCloud = subscribeActivePollCloud(getFirebaseUid(), (cp) => {
      setCloudPoll(cp);
      setLoading(false);
    });
    const onAuthChanged = () => {
      void loadPoll();
    };
    window.addEventListener('crovo:auth-updated', onAuthChanged);
    return () => {
      unsubFast();
      unsubCloud();
      window.removeEventListener('crovo:auth-updated', onAuthChanged);
    };
  }, [loadPoll, user?.id]);

  const activePoll: PollState | null = React.useMemo(() => {
    if (cloudPoll && (!poll || cloudPoll.pollId === poll.pollId)) {
      const mergedUserChoice = cloudPoll.userChoice || poll?.userChoice || null;
      if (!poll) return cloudPoll;
      return cloudPoll.totalVotes >= poll.totalVotes
        ? { ...cloudPoll, userChoice: mergedUserChoice }
        : { ...poll, userChoice: mergedUserChoice };
    }
    return cloudPoll || poll;
  }, [cloudPoll, poll]);

  const submitVote = useCallback(
    async (choiceKey: string) => {
      if (!activePoll || activePoll.closed || activePoll.userChoice || submitting) return;
      setSubmitting(choiceKey);
      setError(null);
      try {
        try {
          const updated = await api.votePoll(choiceKey, activePoll.pollId);
          setPoll(updated);
          setCloudPoll(updated);
          setFastPoll(updated);
        } catch (apiErr) {
          if (apiErr instanceof ApiError && (apiErr.status === 401 || apiErr.status === 403 || apiErr.status === 409)) {
            throw apiErr;
          }
          const fbUid = getFirebaseUid();
          if (!fbUid || !activePoll.pollId) throw apiErr;
          const cloudRes = await votePollCloud(activePoll.pollId, fbUid, choiceKey);
          if (!cloudRes) throw apiErr;
          setPoll(cloudRes);
          setCloudPoll(cloudRes);
          setFastPoll(cloudRes);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          openAuthModal(
            'سجّل دخولك أو أنشئ حسابًا سريعًا حتى يتم احتساب صوتك (صوت واحد فقط لكل حساب).',
            async () => {
              await submitVote(choiceKey);
            }
          );
          return;
        }
        setError(err instanceof Error ? err.message : 'تعذر تسجيل صوتك.');
        await loadPoll();
      } finally {
        setSubmitting(null);
      }
    },
    [activePoll, submitting, openAuthModal, loadPoll]
  );

  const handleOptionClick = (choiceKey: string) => {
    if (!activePoll || activePoll.closed || activePoll.userChoice || submitting) return;
    if (!user) {
      openAuthModal(
        'التصويت متاح لأصحاب الحسابات فقط لمنع تكرار الأصوات. سجل دخول أو أنشئ حسابًا في ثواني!',
        async () => {
          try {
            const latest = await api.getPoll();
            setPoll(latest);
            if (!latest.closed && !latest.userChoice) {
              const updated = await api.votePoll(choiceKey, latest.pollId);
              setPoll(updated);
              setCloudPoll(updated);
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'تعذر تسجيل صوتك.');
            await loadPoll();
          }
        }
      );
      return;
    }
    void submitVote(choiceKey);
  };

  const pollToRender = activePoll;

  const options =
    pollToRender?.options && pollToRender.options.length > 0
      ? pollToRender.options
      : [
          {
            key: 'extend',
            label: 'أيوه، نمد العرض.',
            count: pollToRender?.extendCount || 0,
            percent: pollToRender?.extendPercent || 0,
          },
          {
            key: 'enough',
            label: 'لا، العرض كفاية.',
            count: pollToRender?.enoughCount || 0,
            percent: pollToRender?.enoughPercent || 0,
          },
        ];

  const isClosed = Boolean(pollToRender?.closed);
  const alreadyVoted = Boolean(pollToRender?.userChoice);

  return (
    <section
      id="extend-offer-poll"
      data-testid="extend-offer-poll"
      className="max-w-5xl mx-auto px-3 sm:px-6 my-6 sm:my-8"
    >
      <div className="clay-card p-5 sm:p-8 text-right border border-white/90 relative overflow-hidden">
        {/* Soft Ambient Snowy Indigo Glow */}
        <div className="hidden sm:block absolute -top-16 -left-16 w-48 h-48 rounded-full bg-indigo-500/8 pointer-events-none" />

        {/* Header & Status Row */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full clay-inset text-indigo-700 text-[11px] font-bold font-decorative">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                <span>استفتاء الطلاب المباشر</span>
              </span>

              <span
                data-testid="poll-status-badge"
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold font-ios ${
                  isClosed
                    ? 'bg-rose-100/80 text-rose-700 border border-rose-200'
                    : 'bg-indigo-100/90 text-indigo-700 border border-indigo-200'
                }`}
              >
                {isClosed ? <Lock className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                <span>{isClosed ? 'مغلق' : 'تصويت نشط'}</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black font-decorative text-slate-900 pt-1">
              {pollToRender?.question || 'إيه رأيكم نمد العرض؟'}
            </h2>
            <p className="text-xs text-slate-600 font-ios">
              صوت واحد فقط لكل حساب مسجّل — النتائج والنسب المئوية تتحدث مباشرة بشفافية كاملة.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            <div
              data-testid="poll-total-votes"
              className="px-3.5 py-1.5 rounded-2xl clay-inset text-xs font-bold text-slate-700 font-mono tabular-nums"
            >
              إجمالي الأصوات:{' '}
              <span className="text-indigo-700 font-black">{pollToRender ? pollToRender.totalVotes : 0}</span>
            </div>
          </div>
        </div>

        {/* Account Required Notice if Signed Out */}
        {!user && !isClosed && (
          <div className="mb-4 p-3 rounded-2xl bg-gradient-to-l from-indigo-50/90 via-white/80 to-purple-50/90 border border-indigo-200/70 flex flex-wrap items-center justify-between gap-2 text-xs font-ios">
            <span className="font-bold text-slate-700">
              سجّل دخولك بحسابك أو أنشئ حساباً في ثوانٍ للتصويت (يُمنع التصويت المكرر).
            </span>
            <button
              type="button"
              data-testid="poll-login-cta"
              onClick={() =>
                openAuthModal('سجّل دخولك أو أنشئ حسابًا جديدًا لتسجيل صوتك في الاستفتاء.')
              }
              className="clay-purple-soft px-3.5 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>دخول للتصويت</span>
            </button>
          </div>
        )}

        {error && (
          <div
            data-testid="poll-error-banner"
            className="mb-4 p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-xs font-bold text-rose-700 font-ios"
          >
            {error}
          </div>
        )}

        {loading && !pollToRender ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="h-24 rounded-2xl clay-inset animate-pulse" />
            <div className="h-24 rounded-2xl clay-inset animate-pulse" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Choice Cards */}
            <div className={`grid grid-cols-1 ${options.length >= 2 ? 'sm:grid-cols-2' : ''} gap-3.5`}>
              {options.map((opt, idx) => {
                const isSelected = pollToRender?.userChoice === opt.key;
                const isClickable = !isClosed && !alreadyVoted && !submitting;
                const accentBar =
                  idx % 2 === 0
                    ? 'from-indigo-600 to-purple-600'
                    : 'from-sky-500 to-indigo-600';

                return (
                  <button
                    key={opt.key}
                    type="button"
                    data-testid={`poll-option-${opt.key}`}
                    disabled={!isClickable && Boolean(user)}
                    onClick={() => handleOptionClick(opt.key)}
                    className={`p-4 sm:p-5 rounded-2xl text-right transition-transform duration-150 relative overflow-hidden ${
                      isSelected
                        ? 'clay-purple-soft ring-2 ring-indigo-500 shadow-md'
                        : isClickable
                        ? 'clay-btn hover:ring-2 hover:ring-indigo-300/80 cursor-pointer'
                        : 'clay-inset opacity-95 cursor-default'
                    }`}
                  >
                    <div className="relative z-10 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white border border-indigo-200 text-transparent'
                            }`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs sm:text-sm font-black font-ios text-slate-900 truncate">
                            {opt.label}
                          </span>
                        </div>

                        <div className="text-left font-mono tabular-nums shrink-0">
                          <span className="text-base sm:text-lg font-black text-indigo-700">
                            {opt.percent}%
                          </span>
                          <span className="block text-[10px] font-bold text-slate-500">
                            {opt.count} صوت
                          </span>
                        </div>
                      </div>

                      {/* Compositor-friendly percentage bar */}
                      <div className="w-full h-2.5 rounded-full bg-slate-200/80 overflow-hidden shadow-inner">
                        <div
                          className={`h-full w-full rounded-full bg-gradient-to-l ${accentBar} origin-right transition-transform duration-500`}
                          style={{ transform: `scaleX(${Math.max(0.02, opt.percent / 100)})` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Summary Distribution Chart Strip */}
            {pollToRender && pollToRender.totalVotes > 0 && (
              <div className="clay-inset p-3 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 font-ios">
                  <span>توزيع النسب المئوية المباشر</span>
                  <span className="font-mono text-indigo-700">100%</span>
                </div>
                <div className="w-full h-3 rounded-full overflow-hidden bg-white flex">
                  {options.map((opt, idx) => (
                    <div
                      key={opt.key}
                      title={`${opt.label}: ${opt.percent}%`}
                      className={`h-full transition-all duration-500 ${
                        idx % 2 === 0
                          ? 'bg-gradient-to-r from-indigo-600 to-purple-500'
                          : 'bg-gradient-to-r from-sky-400 to-indigo-400'
                      }`}
                      style={{ width: `${opt.percent}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {alreadyVoted && (
          <div
            data-testid="poll-already-voted-banner"
            className="mt-4 p-3 rounded-2xl bg-indigo-50/90 border border-indigo-200/80 flex items-center gap-2 text-xs font-bold text-indigo-800 font-ios"
          >
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>تم تسجيل صوتك بنجاح ومرتبط بحسابك ولا يمكن تكراره.</span>
          </div>
        )}
      </div>
    </section>
  );
};
