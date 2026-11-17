import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Download,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../../utils/api';
import { saveLibraryOverrideCloud } from '../../utils/cloudStore';

interface AdminLibraryTabProps {
  onNotice: (msg: string) => void;
  onLibraryChanged: () => void;
}

type LibraryQuestionRow = Awaited<ReturnType<typeof api.adminLibrary>>['questions'][number];

export const AdminLibraryTab: React.FC<AdminLibraryTabProps> = ({
  onNotice,
  onLibraryChanged,
}) => {
  const [grade, setGrade] = useState('bac1');
  const [section, setSection] = useState('js');
  const [q, setQ] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const [questions, setQuestions] = useState<LibraryQuestionRow[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [loading, setLoading] = useState(true);

  // New Question Form
  const [newChapterNum, setNewChapterNum] = useState(1);
  const [newQText, setNewQText] = useState('');
  const [newAText, setNewAText] = useState('');
  const [newIsCode, setNewIsCode] = useState(true);

  // Edit drafts & Delete confirmation
  const [drafts, setDrafts] = useState<Record<string, { qText: string; aText: string; isCode: boolean }>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminLibrary({
        grade,
        section,
        q,
        incomplete: onlyIncomplete,
      });
      setQuestions(res.questions);
      setTotalMatching(res.totalMatching);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل محتوى المكتبة.');
    } finally {
      setLoading(false);
    }
  }, [grade, section, q, onlyIncomplete, onNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLibrary();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadLibrary]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const targetGrade: 'bac1' | 'bac2' = grade === 'bac2' ? 'bac2' : 'bac1';
      const targetSection: 'js' | 'py' | 'fin' = section === 'py' || section === 'fin' ? section : 'js';
      const created = await api.adminCreateLibraryQuestion({
        grade: targetGrade,
        section: targetSection,
        chapterNum: newChapterNum,
        qText: newQText,
        aText: newAText,
        isCode: newIsCode,
      });
      void saveLibraryOverrideCloud({
        id: created.id,
        grade: targetGrade,
        section: targetSection,
        chapterNum: newChapterNum,
        qIndex: questions.filter((qItem) => qItem.chapterNum === newChapterNum).length,
        qText: newQText,
        aText: newAText,
        isCode: newIsCode,
        deleted: false,
      });
      setNewQText('');
      setNewAText('');
      onNotice('تمت إضافة السؤال إلى المكتبة بنجاح.');
      onLibraryChanged();
      loadLibrary();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إضافة السؤال.');
    }
  };

  const handleSaveEdit = async (item: LibraryQuestionRow) => {
    const draft = drafts[item.id];
    if (!draft) return;
    try {
      await api.adminUpdateLibraryQuestion(item.id, draft);
      void saveLibraryOverrideCloud({
        id: item.id,
        grade: item.grade,
        section: item.section,
        chapterNum: item.chapterNum,
        qIndex: item.qIndex,
        qText: draft.qText,
        aText: draft.aText,
        isCode: draft.isCode,
        deleted: false,
      });
      onNotice('تم حفظ تعديل السؤال وتحديث توقيت التعديل.');
      onLibraryChanged();
      loadLibrary();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر حفظ التعديل.');
    }
  };

  const handleDelete = async (item: LibraryQuestionRow) => {
    try {
      await api.adminDeleteLibraryQuestion(item.id);
      void saveLibraryOverrideCloud({
        id: item.id,
        grade: item.grade,
        section: item.section,
        chapterNum: item.chapterNum,
        qIndex: item.qIndex,
        qText: item.qText,
        aText: item.aText,
        isCode: item.isCode,
        deleted: true,
      });
      setConfirmDeleteId(null);
      onNotice('تم حذف السؤال من المكتبة.');
      onLibraryChanged();
      loadLibrary();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر الحذف.');
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.adminExportLibrary();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crovo-library-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotice('تم تصدير نسخة JSON من المكتبة.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التصدير.');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : [];
      if (list.length === 0) {
        onNotice('الملف لا يحتوي على أسئلة صالحة.');
        return;
      }
      const res = await api.adminImportLibrary(list);
      onNotice(`تم استيراد ${res.importedCount} سؤال بنجاح.`);
      onLibraryChanged();
      loadLibrary();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر استيراد الملف.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-library-tab">
      {/* Toolbar: Filters + Export/Import */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-black font-decorative">
              إدارة محتوى المكتبة التعليمية ({totalMatching} سؤال مطابق)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="clay-btn px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 text-indigo-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير JSON</span>
            </button>

            <label className="clay-btn px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 text-purple-700 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>استيراد JSON</span>
              <input type="file" accept=".json,application/json" onChange={handleImportFile} className="hidden" />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل السنوات</option>
            <option value="bac1">أولى بكالوريا</option>
            <option value="bac2">تانية بكالوريا</option>
          </select>

          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل المواد</option>
            <option value="js">جافا Java</option>
            <option value="py">بايثون Python</option>
            <option value="fin">الثقافة المالية</option>
          </select>

          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث في السؤال أو الحل..."
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none"
          />

          <label className="px-3 py-2 rounded-xl clay-inset flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={onlyIncomplete}
              onChange={(e) => setOnlyIncomplete(e.target.checked)}
            />
            <span className="text-amber-700">الإجابات الناقصة/غير المكتملة فقط</span>
          </label>
        </div>
      </div>

      {/* Add Question Card */}
      <form onSubmit={handleCreate} className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2 font-black font-decorative text-sm text-slate-900">
          <Plus className="w-4 h-4 text-indigo-600" />
          <span>إضافة سؤال جديد إلى ({grade === 'bac2' ? 'تانية' : 'أولى'} · {section})</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div>
            <label className="block font-bold mb-1">رقم المستوى / الفصل:</label>
            <input
              type="number"
              min={1}
              max={200}
              value={newChapterNum}
              onChange={(e) => setNewChapterNum(Number(e.target.value) || 1)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-bold mb-1">نص السؤال:</label>
            <input
              type="text"
              required
              value={newQText}
              onChange={(e) => setNewQText(e.target.value)}
              placeholder="اكتب عنوان أو نص السؤال..."
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={newIsCode}
                onChange={(e) => setNewIsCode(e.target.checked)}
              />
              <span>إجابة برمجية (Code)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block font-bold mb-1">الإجابة:</label>
          <textarea
            required
            rows={2}
            dir={newIsCode ? 'ltr' : 'rtl'}
            value={newAText}
            onChange={(e) => setNewAText(e.target.value)}
            placeholder="اكتب الكود أو الحل النموذجي..."
            className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
          />
        </div>

        <button
          type="submit"
          className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>إضافة السؤال</span>
        </button>
      </form>

      {/* Questions List */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        {loading && questions.length === 0 ? (
          <div className="p-6 text-center text-slate-500">جاري التحميل...</div>
        ) : questions.length === 0 ? (
          <div className="p-6 text-center text-slate-500 clay-inset rounded-2xl">
            لا توجد أسئلة مطابقة للتصفية الحالية.
          </div>
        ) : (
          questions.slice(0, 60).map((item) => {
            const draft = drafts[item.id] || {
              qText: item.qText,
              aText: item.aText,
              isCode: item.isCode,
            };
            const isModified = Boolean(drafts[item.id]);

            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-2xl clay-inset space-y-2 ${
                  item.isIncomplete ? 'ring-2 ring-amber-400/70' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2 font-mono font-bold text-indigo-700">
                    <span>
                      {item.grade} · {item.section} · ف{item.chapterNum} · #{item.qIndex + 1}
                    </span>
                    {item.isIncomplete && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-ios">
                        <AlertTriangle className="w-3 h-3" />
                        <span>ناقص/يحتاج مراجعة</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    آخر تعديل: {item.updatedAt.slice(0, 10)} ({item.updatedBy || 'system'})
                  </div>
                </div>

                <input
                  type="text"
                  value={draft.qText}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [item.id]: { ...draft, qText: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-xl clay-card border-none outline-none font-bold"
                />

                <textarea
                  rows={2}
                  dir={draft.isCode ? 'ltr' : 'rtl'}
                  value={draft.aText}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [item.id]: { ...draft, aText: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-xl clay-card border-none outline-none font-mono"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.isCode}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, isCode: e.target.checked },
                        }))
                      }
                    />
                    <span>كود برمجي</span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    {isModified && (
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(item)}
                        className="clay-apple-blue px-3 py-1.5 rounded-xl font-bold text-white flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>حفظ</span>
                      </button>
                    )}

                    {confirmDeleteId === item.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          className="px-3 py-1.5 rounded-xl bg-rose-600 text-white font-bold"
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="clay-btn px-2.5 py-1.5 rounded-xl"
                        >
                          إلغاء
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        className="clay-btn px-2.5 py-1.5 rounded-xl text-rose-600 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
