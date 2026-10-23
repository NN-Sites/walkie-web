// סוגי הדיווח על אוטובוס. משותף לאפליקציה ולדף הניהול (שאינו צריך את שאר קוד הקהילה).

export const REPORT_TYPES = Object.freeze([
  { id: 'crowded', icon: '👥', label: 'עומס באוטובוס' },
  { id: 'inspector', icon: '🎫', label: 'פקח / בקרת כרטיסים' },
  { id: 'delay', icon: '⏱️', label: 'עיכוב או שיבוש' },
  { id: 'breakdown', icon: '🔧', label: 'תקלה ברכב' },
  { id: 'driver', icon: '🧑‍✈️', label: 'התנהגות נהג' },
  { id: 'accessibility', icon: '♿', label: 'בעיית נגישות' },
  { id: 'cleanliness', icon: '🧹', label: 'ניקיון' },
  { id: 'other', icon: '💬', label: 'אחר' }
]);
