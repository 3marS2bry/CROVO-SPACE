export type AcademicGrade = 'bac1' | 'bac2';

export type SectionType = 'js' | 'py' | 'fin';

export interface QuestionItem {
  q: string;
  a: string;
  code?: boolean;
}

export interface Chapter {
  num: number;
  title?: string;
  qs: QuestionItem[];
}

export interface StudentStats {
  xp: number;
  level: number;
  streak: number;
  completedQuestions: Record<string, boolean>; // e.g., 'bac1-js-0-0': true
  lastStudyDate: string;
}

export interface StudentQuote {
  quote: string;
  author: string;
}

export interface ToolScreenshot {
  src: string;
  title: string;
  description: string;
  category: 'code' | 'exam' | 'platform';
}

export interface ToolVideo {
  src: string;
  title: string;
  description: string;
  tag: string;
}
