/** The app's frame: top bar, tools, floors, panels. */
export default {
  // Top bar
  Language: 'اللغة',
  Theme: 'المظهر',
  Light: 'فاتح',
  Dark: 'داكن',
  System: 'حسب الجهاز',
  Undo: 'تراجع',
  'Undo (Ctrl+Z)': 'تراجع (Ctrl+Z)',
  Redo: 'إعادة',
  'Redo (Ctrl+Y)': 'إعادة (Ctrl+Y)',
  'View mode': 'طريقة العرض',
  'Suggest an interior design': 'اقتراح تصميم داخلي',
  Design: 'تصميم',
  'Switch units': 'تبديل الوحدات',
  'View options': 'خيارات العرض',
  'Plan view': 'عرض المخطط',
  'Snap to grid & walls': 'الالتصاق بالشبكة والحوائط',
  'Show grid': 'إظهار الشبكة',
  'Show wall lengths': 'إظهار أطوال الحوائط',
  'Show room areas': 'إظهار مساحات الغرف',
  'Show dimension lines': 'إظهار خطوط الأبعاد',
  'Show floor below': 'إظهار الطابق السفلي',
  'Export / import': 'تصدير / استيراد',
  'Export or import': 'تصدير أو استيراد',
  'Print to scale (PDF)…': 'طباعة بمقياس رسم (PDF)…',
  'Export current floor': 'تصدير الطابق الحالي',
  'PNG image': 'صورة PNG',
  'SVG vector': 'رسم متجه SVG',
  Import: 'استيراد',
  'Sketch or photo of a plan…': 'رسم يدوي أو صورة لمخطط…',
  'Project file': 'ملف المشروع',
  'Save project (.json)': 'حفظ المشروع (.json)',
  'Open project file…': 'فتح ملف مشروع…',
  'Opened “{name}”': 'تم فتح «{name}»',
  'Take the tour': 'جولة تعريفية',
  'Hide panel': 'إخفاء اللوحة',
  'Show panel': 'إظهار اللوحة',
  'Toggle panel': 'إظهار أو إخفاء اللوحة',

  // Tools
  'Select & move (Shift + click to add)': 'تحديد وتحريك (Shift + نقرة للإضافة)',
  'Select several (drag a box)': 'تحديد عدة عناصر (اسحب مستطيلًا)',
  'Draw room (click corners)': 'رسم غرفة (انقر على الأركان)',
  'Draw rectangular room (drag)': 'رسم غرفة مستطيلة (اسحب)',
  'Draw balcony (drag)': 'رسم بلكونة (اسحب)',
  'Draw terrace (drag)': 'رسم تراس (اسحب)',
  'Divide a room in two, with no wall between': 'تقسيم غرفة إلى اثنتين بلا حائط بينهما',
  'Dimension line': 'خط أبعاد',
  Pan: 'تحريك العرض',
  'Connect switches to lights (W)': 'توصيل المفاتيح بالإضاءة (W)',
  'Add 4 × 3 m room': 'إضافة غرفة 4 × 3 م',
  'Add L-shaped room': 'إضافة غرفة على شكل L',
  'Import a sketch or photo': 'استيراد رسم أو صورة',
  'Zoom in (+)': 'تكبير (+)',
  'Zoom out (−)': 'تصغير (−)',
  'Zoom to fit (F)': 'ملاءمة العرض (F)',

  // Hints over the plan
  'Click to place corners · type a length + Enter for exact walls · Enter / double-click / click the first corner to finish · Esc to cancel':
    'انقر لوضع الأركان · اكتب طولًا ثم Enter لحوائط بقياس دقيق · Enter أو نقرة مزدوجة أو النقر على الركن الأول للإنهاء · Esc للإلغاء',
  'Drag to draw a rectangular room': 'اسحب لرسم غرفة مستطيلة',
  'Drag a box around things to select them · Shift adds to the selection': 'اسحب مستطيلًا حول العناصر لتحديدها · Shift يضيف إلى التحديد',
  'Drag to draw a balcony against the outside of a wall · no railing is added where it meets the house':
    'اسحب لرسم بلكونة على الجانب الخارجي لحائط · لا يُضاف درابزين حيث تلتقي بالمنزل',
  'Drag to draw a terrace or patio against the outside of the house': 'اسحب لرسم تراس أو فناء ملاصق للمنزل من الخارج',
  'Drag to move the view': 'اسحب لتحريك العرض',
  'Click the start point, then the end point, then where the dimension line should go · Esc when done':
    'انقر على نقطة البداية، ثم النهاية، ثم مكان خط الأبعاد · Esc عند الانتهاء',
  'Click a wall (or corner) where the line between the two rooms starts, then across the room · straight or at 45° unless you hold Shift · no wall goes in between · Esc to cancel':
    'انقر على حائط (أو ركن) حيث يبدأ الخط الفاصل بين الغرفتين، ثم عبر الغرفة · مستقيم أو بزاوية 45° ما لم تضغط Shift · لا يُبنى حائط بينهما · Esc للإلغاء',
  'Click a switch, then click the lights it should control': 'انقر على مفتاح، ثم على الإضاءة التي يتحكم بها',
  'Wiring {name}: click lights to connect or disconnect them · click another switch to wire it · Esc when done':
    'توصيل {name}: انقر على الإضاءة لتوصيلها أو فصلها · انقر على مفتاح آخر لتوصيله · Esc عند الانتهاء',
  'this switch': 'هذا المفتاح',

  // Layers
  Plan: 'المخطط',
  Lighting: 'الإضاءة',
  'Show or fade categories': 'إظهار الفئات أو تخفيتها',
  Show: 'إظهار',
  '{n} faded': '{n} مُخفّتة',
  'Show on the plan': 'الإظهار على المخطط',
  "Faded items can't be clicked, so you can work around them.": 'لا يمكن النقر على العناصر المخفّتة، فتعمل حولها بسهولة.',
  'Show everything': 'إظهار الكل',
  'Lights & switches': 'الإضاءة والمفاتيح',
  'Gypsum boxes': 'صناديق الجبس',
  Dimensions: 'الأبعاد',
  'Saved 3D views': 'لقطات ثلاثية الأبعاد محفوظة',

  // Clipboard, saving
  '1 item': 'عنصر واحد',
  '{n} items': '{n} عناصر',
  'Copied {items}': 'تم نسخ {items}',
  'Cut {items}': 'تم قص {items}',
  'Paste with Ctrl+V, on this floor or another.': 'الصق بـ Ctrl+V، في هذا الطابق أو غيره.',
  'Browser storage is full, so changes are not being saved. Remove a background drawing or save the project to a file.':
    'مساحة تخزين المتصفح ممتلئة، فلا يتم حفظ التغييرات. احذف صورة خلفية أو احفظ المشروع في ملف.',
  'Opening the 3D view': 'جارٍ فتح العرض ثلاثي الأبعاد',
  'Opening the 3D view…': 'جارٍ فتح العرض ثلاثي الأبعاد…',

  // Empty floor
  "Let's get your floor plan in": 'لنبدأ بمخططك',
  'Pick whatever is quickest for you.': 'اختر الأسرع لك.',
  'Draw a room': 'ارسم غرفة',
  'Use a template': 'استخدم نموذجًا جاهزًا',

  // Floors
  'Add floor above': 'إضافة طابق أعلى',
  'Duplicate this floor': 'تكرار هذا الطابق',
  'Delete this floor': 'حذف هذا الطابق',
  'Delete “{name}”?': 'حذف «{name}»؟',
  'All rooms and symbols on this floor will be removed. You can undo this with Ctrl+Z.':
    'ستُحذف كل الغرف والعناصر في هذا الطابق. يمكنك التراجع بـ Ctrl+Z.',
  Cancel: 'إلغاء',
  Delete: 'حذف',

  // Side panel
  Properties: 'الخصائص',
  Library: 'المكتبة',
  Summary: 'الملخص',
  'Shared with you to view': 'تمت مشاركته معك للعرض',
  'You can look around, measure and walk through it in 3D. To change it, make your own copy.':
    'يمكنك التجول فيه وقياسه والسير داخله ثلاثي الأبعاد. لتعديله، أنشئ نسختك الخاصة.',
  'Make a copy': 'إنشاء نسخة',
} as Record<string, string>
