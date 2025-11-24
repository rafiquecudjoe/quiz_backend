# Diagram Storage - Concrete Example

## Scenario: Question with 2 Parts and 2 Diagrams

Let's say you have **Question 5** on **Page 3** with **2 parts** that each reference a diagram:

### PDF Content

```
Question 5

Consider the two triangles shown in the diagrams below:

(a) Calculate the area of Triangle ABC. [2 marks]
    [Diagram showing Triangle ABC with base 5cm and height 4cm]

(b) Find the perimeter of Triangle XYZ. [2 marks]
    [Diagram showing Triangle XYZ with sides 3cm, 4cm, 5cm]
```

---

## How It's Stored

### 1. Python Processor Extracts Diagrams

The Python processor saves two PNG files:
```
output/test/
├── page_3_diagram_0.png  ← Triangle ABC
└── page_3_diagram_1.png  ← Triangle XYZ
```

### 2. NestJS Uploads to MinIO

```typescript
// Upload diagram 0
{
  url: "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_0.png",
  key: "job-abc-123/page_3_diagram_0.png",
  fileName: "page_3_diagram_0.png",
  fileSize: 45678
}

// Upload diagram 1
{
  url: "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_1.png",
  key: "job-abc-123/page_3_diagram_1.png",
  fileName: "page_3_diagram_1.png",
  fileSize: 52341
}
```

### 3. MongoDB Document Structure

```json
{
  "_id": ObjectId("657abc..."),
  "jobId": "job-abc-123",
  "questionNum": "5",
  "pageNumber": 3,
  "questionText": "Consider the two triangles shown in the diagrams below:",
  
  "parts": [
    {
      "part": "(a)",
      "question_text": "Calculate the area of Triangle ABC.",
      "marks": 2,
      "options": [
        {"label": "A", "text": "10 cm²"},
        {"label": "B", "text": "20 cm²"},
        {"label": "C", "text": "15 cm²"},
        {"label": "D", "text": "8 cm²"}
      ],
      "correct_option": "A",
      "sample_answer": "Area = (1/2) × base × height = (1/2) × 5 × 4 = 10 cm²"
    },
    {
      "part": "(b)",
      "question_text": "Find the perimeter of Triangle XYZ.",
      "marks": 2,
      "options": [
        {"label": "A", "text": "10 cm"},
        {"label": "B", "text": "12 cm"},
        {"label": "C", "text": "15 cm"},
        {"label": "D", "text": "8 cm"}
      ],
      "correct_option": "B",
      "sample_answer": "Perimeter = 3 + 4 + 5 = 12 cm"
    }
  ],
  
  "diagrams": [
    {
      "id": "diagram-uuid-1",
      "questionPart": "(a)",
      "pageNumber": 3,
      "minioUrl": "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_0.png",
      "minioKey": "job-abc-123/page_3_diagram_0.png",
      "fileName": "page_3_diagram_0.png",
      "contentType": "image/png",
      "fileSize": 45678,
      "bbox": {"x": 100, "y": 200, "width": 400, "height": 300},
      "uploadedAt": ISODate("2025-11-19T10:00:00.000Z")
    },
    {
      "id": "diagram-uuid-2",
      "questionPart": "(b)",
      "pageNumber": 3,
      "minioUrl": "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_1.png",
      "minioKey": "job-abc-123/page_3_diagram_1.png",
      "fileName": "page_3_diagram_1.png",
      "contentType": "image/png",
      "fileSize": 52341,
      "bbox": {"x": 150, "y": 550, "width": 350, "height": 250},
      "uploadedAt": ISODate("2025-11-19T10:00:00.000Z")
    }
  ],
  
  "marks": 4,
  "createdAt": ISODate("2025-11-19T10:00:00.000Z")
}
```

---

## API Response

When you call `GET /api/pdf/results/:jobId`:

```json
{
  "jobId": "job-abc-123",
  "filename": "exam.pdf",
  "status": "completed",
  "questions": [
    {
      "id": "657abc...",
      "questionNum": "5",
      "pageNumber": 3,
      "questionText": "Consider the two triangles shown in the diagrams below:",
      "parts": [
        {
          "part": "(a)",
          "question_text": "Calculate the area of Triangle ABC.",
          "marks": 2,
          "options": [
            {"label": "A", "text": "10 cm²"},
            {"label": "B", "text": "20 cm²"},
            {"label": "C", "text": "15 cm²"},
            {"label": "D", "text": "8 cm²"}
          ],
          "correct_option": "A",
          "sample_answer": "Area = (1/2) × base × height = (1/2) × 5 × 4 = 10 cm²"
        },
        {
          "part": "(b)",
          "question_text": "Find the perimeter of Triangle XYZ.",
          "marks": 2,
          "options": [
            {"label": "A", "text": "10 cm"},
            {"label": "B", "text": "12 cm"},
            {"label": "C", "text": "15 cm"},
            {"label": "D", "text": "8 cm"}
          ],
          "correct_option": "B",
          "sample_answer": "Perimeter = 3 + 4 + 5 = 12 cm"
        }
      ],
      "diagrams": [
        {
          "id": "diagram-uuid-1",
          "questionPart": "(a)",
          "pageNumber": 3,
          "minioUrl": "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_0.png",
          "fileName": "page_3_diagram_0.png",
          "contentType": "image/png",
          "fileSize": 45678
        },
        {
          "id": "diagram-uuid-2",
          "questionPart": "(b)",
          "pageNumber": 3,
          "minioUrl": "http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_1.png",
          "fileName": "page_3_diagram_1.png",
          "contentType": "image/png",
          "fileSize": 52341
        }
      ],
      "marks": 4
    }
  ]
}
```

---

## Frontend Rendering Example

### React Component

```tsx
import React from 'react';

interface Question {
  questionNum: string;
  questionText: string;
  parts: Part[];
  diagrams: Diagram[];
}

interface Part {
  part: string;
  question_text: string;
  marks: number;
  options: Option[];
  correct_option: string;
  sample_answer: string;
}

interface Diagram {
  id: string;
  questionPart: string | null;
  minioUrl: string;
  fileName: string;
}

function QuizQuestion({ question }: { question: Question }) {
  return (
    <div className="question">
      <h2>Question {question.questionNum}</h2>
      <p>{question.questionText}</p>
      
      {question.parts.map((part) => {
        // Find diagrams for this part
        const partDiagrams = question.diagrams.filter(
          d => d.questionPart === part.part
        );
        
        return (
          <div key={part.part} className="question-part">
            <h3>{part.part} {part.question_text} ({part.marks} marks)</h3>
            
            {/* Display diagrams for this part */}
            {partDiagrams.map((diagram) => (
              <div key={diagram.id} className="diagram">
                <img 
                  src={diagram.minioUrl}
                  alt={`Diagram for ${part.part}`}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            ))}
            
            {/* Display options */}
            <div className="options">
              {part.options.map((option) => (
                <div key={option.label}>
                  <input 
                    type="radio" 
                    name={`q${question.questionNum}_${part.part}`}
                    value={option.label}
                  />
                  <label>{option.label}. {option.text}</label>
                </div>
              ))}
            </div>
            
            {/* Show answer (toggle) */}
            <details>
              <summary>Show Answer</summary>
              <p><strong>Correct Answer:</strong> {part.correct_option}</p>
              <p><strong>Explanation:</strong> {part.sample_answer}</p>
            </details>
          </div>
        );
      })}
    </div>
  );
}

export default QuizQuestion;
```

### Rendered Output

```
┌─────────────────────────────────────────────────────┐
│ Question 5                                          │
│ Consider the two triangles shown in the diagrams   │
│ below:                                              │
│                                                     │
│ (a) Calculate the area of Triangle ABC. (2 marks)  │
│                                                     │
│ ┌───────────────────────────────────┐              │
│ │                                   │              │
│ │    [Triangle ABC Diagram]         │              │
│ │    Base: 5cm, Height: 4cm         │              │
│ │                                   │              │
│ └───────────────────────────────────┘              │
│                                                     │
│ ○ A. 10 cm²                                         │
│ ○ B. 20 cm²                                         │
│ ○ C. 15 cm²                                         │
│ ○ D. 8 cm²                                          │
│                                                     │
│ ▼ Show Answer                                       │
│                                                     │
│ (b) Find the perimeter of Triangle XYZ. (2 marks)  │
│                                                     │
│ ┌───────────────────────────────────┐              │
│ │                                   │              │
│ │    [Triangle XYZ Diagram]         │              │
│ │    Sides: 3cm, 4cm, 5cm           │              │
│ │                                   │              │
│ └───────────────────────────────────┘              │
│                                                     │
│ ○ A. 10 cm                                          │
│ ○ B. 12 cm                                          │
│ ○ C. 15 cm                                          │
│ ○ D. 8 cm                                           │
│                                                     │
│ ▼ Show Answer                                       │
└─────────────────────────────────────────────────────┘
```

---

## Diagram Access Patterns

### 1. Get All Diagrams for a Question

```typescript
const allDiagrams = question.diagrams;
// Returns all diagrams regardless of part
```

### 2. Get Diagrams for Specific Part

```typescript
const partADiagrams = question.diagrams.filter(
  d => d.questionPart === "(a)"
);

const partBDiagrams = question.diagrams.filter(
  d => d.questionPart === "(b)"
);
```

### 3. Get Diagrams Not Assigned to Any Part

```typescript
const generalDiagrams = question.diagrams.filter(
  d => d.questionPart === null
);
```

### 4. Count Diagrams Per Part

```typescript
const diagramCounts = question.parts.map(part => ({
  part: part.part,
  count: question.diagrams.filter(d => d.questionPart === part.part).length
}));

// Result: [
//   { part: "(a)", count: 1 },
//   { part: "(b)", count: 1 }
// ]
```

---

## Multiple Diagrams Per Part Example

If part (b) has **2 diagrams**:

```json
{
  "questionNum": "5",
  "parts": [
    {"part": "(a)", "question_text": "..."},
    {"part": "(b)", "question_text": "Compare the two diagrams below..."}
  ],
  "diagrams": [
    {
      "id": "diagram-1",
      "questionPart": "(a)",
      "minioUrl": "http://localhost:9000/.../page_3_diagram_0.png"
    },
    {
      "id": "diagram-2",
      "questionPart": "(b)",  // First diagram for part (b)
      "minioUrl": "http://localhost:9000/.../page_3_diagram_1.png"
    },
    {
      "id": "diagram-3",
      "questionPart": "(b)",  // Second diagram for part (b)
      "minioUrl": "http://localhost:9000/.../page_3_diagram_2.png"
    }
  ]
}
```

Frontend rendering:

```tsx
{partBDiagrams.map((diagram, index) => (
  <div key={diagram.id}>
    <p>Diagram {index + 1}</p>
    <img src={diagram.minioUrl} alt={`Diagram ${index + 1}`} />
  </div>
))}
```

---

## Direct MinIO URLs

The diagrams are **publicly accessible** via direct HTTP:

```bash
# Triangle ABC
http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_0.png

# Triangle XYZ  
http://localhost:9000/pdf-diagrams/job-abc-123/page_3_diagram_1.png
```

You can:
- Display in `<img>` tags
- Download directly
- Embed in PDFs
- Share links
- Cache with CDN

---

## Summary

✅ **Clear diagram-to-part mapping** - Each diagram knows which part it belongs to  
✅ **Multiple diagrams per part** - Supported via array filtering  
✅ **Public URLs** - Direct access from MinIO  
✅ **Type-safe** - Prisma Diagram type with validation  
✅ **Flexible** - Can map diagrams to entire question or specific parts  
✅ **Frontend-friendly** - Easy to filter and display  

Your diagram storage is now fully structured and ready for production use! 🎨

