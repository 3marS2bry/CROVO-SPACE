import React, { useState } from 'react';
import { Sparkles, Terminal, Copy, Check, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { sounds } from '../utils/soundEffects';

const SAMPLE_QUESTIONS = [
  {
    title: 'امتحان جافاسكريبت: مشكلة البحث في مصفوفة وتكرار العناصر',
    query: 'عايز كود جافاسكريبت يرجع العناصر المتكررة في مصفوفة مع الشرح خطوة بخطوة',
    language: 'javascript',
    solution: `// كود حل المسألة بأبسط وأسرع طريقة
function findDuplicates(arr) {
  const seen = new Set();
  const duplicates = new Set();

  for (const item of arr) {
    if (seen.has(item)) {
      duplicates.add(item);
    } else {
      seen.add(item);
    }
  }

  return Array.from(duplicates);
}

// تجربة الكود
const numbers = [1, 2, 3, 2, 4, 5, 1, 6];
console.log(findDuplicates(numbers)); // [2, 1]`,
    explanation: `💡 شرح الحل بالبلدي عشان تقفل في الامتحان:
1. استخدمنا الـ Set عشان سرعة البحث فيها O(1) ومش هتاخد وقت في التنفيذ.
2. مرينا على كل عنصر في الـ Array؛ لو شوفناه قبل كده ضفناه لمجموعة الـ duplicates.
3. رجعنا مصفوفة نظيفة فيها العناصر المتكررة فقط وبدون أي أخطاء!`
  },
  {
    title: 'امتحان بايثون: حساب مضروب الرقم (Factorial) باستخدام Recursion',
    query: 'اكتب دالة بايثون تحسب مضروب الرقم بالطريقة التكرارية والشرط الأساسي',
    language: 'python',
    solution: `# دالة حساب المضروب بلغة بايثون
def factorial(n):
    # الشرط الأساسي لإيقاف التكرار (Base Case)
    if n <= 1:
        return 1
    # الاستدعاء الذاتي للدالة (Recursive Step)
    return n * factorial(n - 1)

# مثال تشغيل:
result = factorial(5)
print(f"5! = {result}")  # 5! = 120`,
    explanation: `💡 فكرة السؤال ده بتتكرر في 90% من الامتحانات:
1. الـ Base Case لازم يكون n <= 1 عشان الدالة متفضلش شغلة لما لا نهاية وتضرب Stack Overflow.
2. كل خطوة بنضرب الرقم الحالي في مضروب الرقم اللي قبله لحد ما نوصل لـ 1.`
  },
  {
    title: 'سؤال نظري: الفرق بين التمويل المباشر وغير المباشر (الثقافة المالية)',
    query: 'وضح الفرق بين التمويل المباشر والتمويل غير المباشر مع مثال عملي لكل نوع',
    language: 'text',
    solution: `التمويل المباشر:
- بيتم فيه انتقال الأموال مباشرة من المدخر (المستثمر) للمقترض عن طريق شراء الأسهم أو السندات في سوق الأوراق المالية، بدون وسيط مصرفي يتحمل المخاطرة.

التمويل غير المباشر:
- بيتم عبر وسيط مالي (زي البنوك)، البنك بيجمع الودائع من الناس ويديهم فايدة، وبعدين يقرضها للمشاريع وياخد فايدة أعلى.`,
    explanation: `💡 نصيحة للامتحان: اذكر دايمًا مثال البنك في غير المباشر، والبورصة والأسهم في التمويل المباشر!`
  }
];

export const InteractiveDemo: React.FC = () => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [isSolving, setIsSolving] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'explanation'>('code');
  const [copied, setCopied] = useState(false);

  const curSample = SAMPLE_QUESTIONS[selectedIdx];

  const handleSolve = () => {
    sounds.playClick();
    setIsSolving(true);
    setTimeout(() => {
      setIsSolving(false);
      sounds.playCopySuccess();
    }, 650);
  };

  const handleCopy = (text: string) => {
    sounds.playCopySuccess();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const WHATSAPP_URL =
    'https://wa.me/201550324450?text=' + encodeURIComponent('عاوز اشتراك يخوياااا');

  return (
    <div className="w-full clay-card p-6 sm:p-8 relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5 mb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>تجربة حية فورية ومباشرة</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900">
            محاكي أداة حل الامتحانات والمساعد الذكي ⚡
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            جرب بنفسك وشوف الأداة بتتعامل إزاي مع أسئلة الكود والامتحانات بتفكيك وشرح كامل بالمللي!
          </p>
        </div>

        {/* Call to action */}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sounds.playClick()}
          className="clay-whatsapp px-4 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 whitespace-nowrap"
        >
          <MessageCircle className="w-4 h-4" />
          <span>عاوز اشتراك يخوياااا</span>
        </a>
      </div>

      {/* Preset Question Selectors */}
      <div className="mb-5">
        <label className="block text-xs font-bold text-slate-600 mb-2.5">
          اختر نموذج سؤال امتحان لتجربته حالاً:
        </label>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                sounds.playClick();
                setSelectedIdx(idx);
                setCustomInput('');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all text-right ${
                selectedIdx === idx
                  ? 'clay-primary text-white shadow-md'
                  : 'clay-btn text-slate-700 hover:text-indigo-600'
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {/* Live Input Field */}
      <div className="clay-inset p-3 mb-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-1 px-1">
          <Terminal className="w-3.5 h-3.5 text-indigo-500" />
          <span>السؤال البرمجي الموجه للأداة:</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customInput || curSample.query}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="اكتب سؤالك أو اترك النموذج الافتراضي..."
            className="w-full bg-transparent border-none outline-none text-xs sm:text-sm font-semibold text-slate-800 placeholder:text-slate-400 px-2"
          />
          <button
            onClick={handleSolve}
            disabled={isSolving}
            className="clay-primary px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0"
          >
            {isSolving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>جاري الحل...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>حل فوراً</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Output Screen */}
      <div className="rounded-2xl bg-[#0d1117] text-slate-100 p-4 border border-slate-800/90 shadow-inner">
        {/* Output Header Controls */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                sounds.playClick();
                setActiveTab('code');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'code' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              الكود والحل النموذجي
            </button>
            <button
              onClick={() => {
                sounds.playClick();
                setActiveTab('explanation');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'explanation' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              شرح الفكرة للامتحان
            </button>
          </div>

          <button
            onClick={() => handleCopy(activeTab === 'code' ? curSample.solution : curSample.explanation)}
            className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">تم النسخ!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>نسخ المخرجات</span>
              </>
            )}
          </button>
        </div>

        {/* Content Box */}
        {activeTab === 'code' ? (
          <pre className="font-['JetBrains_Mono'] text-xs sm:text-[13px] leading-relaxed text-sky-300 overflow-x-auto whitespace-pre-wrap p-2">
            {curSample.solution}
          </pre>
        ) : (
          <div className="text-xs sm:text-sm text-slate-200 leading-relaxed font-['Cairo'] whitespace-pre-wrap p-2">
            {curSample.explanation}
          </div>
        )}
      </div>

      {/* Bottom Promo Note */}
      <div className="mt-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-amber-900 font-bold">
        <span>
          💡 عجبك الحل؟ دي عينة واحدة.. الأداة الحقيقية معاك في جيبك على الموبايل واللاب تحل وتشرحلك أي سؤال كود في الامتحانات!
        </span>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sounds.playClick()}
          className="clay-whatsapp px-4 py-2 rounded-xl text-xs font-black whitespace-nowrap text-white"
        >
          عاوز اشتراك يخوياااا 💬
        </a>
      </div>
    </div>
  );
};
