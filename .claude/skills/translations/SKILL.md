---
name: translations
description: Add or update translations for pages and components in the Waniwani app. Use when the user wants to add translations, create translation files, internationalize a page, make text translatable, or update existing translations. Also use proactively when creating new pages or components with user-facing text.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Waniwani Translation System

Automatically create and manage translations for pages and components using the Waniwani translation system.

**📚 For real-world examples, see `examples.md` in this directory.**

## When to Use This Skill

Apply this skill when:

- Creating new pages or components with user-facing text
- Adding translations to existing pages
- Updating translation files
- Internationalizing hardcoded text
- The user mentions "translations", "translate", "i18n", "internationalization", or language support

## Translation File Location

**CRITICAL: Co-locate `@translations.ts` with `page.tsx` by default**

```
src/app/(app)/settings/teams/
├── page.tsx              # The page component
├── @translations.ts      # Translations file (place HERE)
└── loading.tsx
```

Only use a different location if the user explicitly requests it.

## Mandatory Requirements

🚨 **ALL pages and components MUST support all 2 languages:**

- English (en)
- French (fr)

**No exceptions.** TypeScript will enforce structural equality across all languages.

## Translation File Structure

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const descriptiveName = defineTranslations({
  en: {
    // Static text - plain strings
    title: "Page Title",

    // Dynamic text - functions with object parameters
    greeting: ({ name }: { name: string }) => `Hello ${name}!`,

    // Nested structure for organization
    actions: {
      save: "Save",
      cancel: "Cancel",
    },
  },
  fr: {
    // Must match "en" structure exactly
    title: "Titre de la page",
    greeting: ({ name }: { name: string }) => `Bonjour ${name} !`,
    actions: {
      save: "Enregistrer",
      cancel: "Annuler",
    },
  },
});
```

**See `examples.md` for comprehensive real-world examples.**

## Static vs Dynamic Content

**Static text (never changes):** Use plain strings
```typescript
title: "Settings"
```

**Dynamic text (includes variables):** Use functions with object parameters
```typescript
greeting: ({ name }: { name: string }) => `Hello ${name}!`
```

**❌ Never use:**
- Template placeholders: `"Hello {name}!"`
- Direct parameters: `(name) => ...`

## Using Translations in Components

```tsx
"use client";
import { useTranslation } from "@/lib/translations/hooks";

export function MyComponent() {
  const t = useTranslation("descriptiveName");

  return (
    <div>
      <h1>{t.title}</h1>  {/* Static */}
      <p>{t.greeting({ name: "World" })}</p>  {/* Dynamic */}
    </div>
  );
}
```

**See `examples.md` for complete component examples with forms, tables, and validation.**

## Required Workflow

When creating or updating translations:

1. **Create `@translations.ts`** next to `page.tsx` with all 2 languages (en, fr)
2. **🚨 CRITICAL: Run rebuild script immediately after creating/modifying translations:**
   ```bash
   bun translations:build
   ```
   **This regenerates the translation index and makes translations available. YOU MUST RUN THIS after any translation file changes!**
3. **Import and use** `useTranslation()` in components
4. **Verify** by checking TypeScript errors (missing keys will error immediately)

## Translation Coverage Checklist

Translate ALL user-facing text:

- ✅ Page titles and descriptions
- ✅ Button labels and action text
- ✅ Form labels and placeholders
- ✅ Error messages and validation text
- ✅ Table headers and column names
- ✅ Dialog/modal titles and content
- ✅ Toast notification messages
- ✅ Empty state messages
- ✅ Loading and status text
- ✅ Help text and tooltips
- ✅ Navigation items

## Common Mistakes to Avoid

❌ **Hardcoded strings**: `<h1>Settings</h1>`
✅ **Use translations**: `<h1>{t.title}</h1>`

❌ **Template placeholders**: `greeting: "Hello {name}!"`
✅ **Use functions**: `greeting: ({ name }) => ...`

❌ **Missing languages**: Only defining en without fr
✅ **All languages**: TypeScript enforces both en and fr

❌ **Forgetting rebuild**: Creating files without running `bun translations:build`
✅ **Always rebuild**: Run `bun translations:build` after changes

## Type Safety Benefits

TypeScript enforces:

- All 2 languages have identical structure
- No missing keys in any language
- No extra keys in any language
- Correct parameter types for dynamic functions

**If structures don't match, you'll get immediate TypeScript errors before runtime.**

## Export Naming Convention

Use descriptive, camelCase names that match the feature:

- ✅ `settings` - for settings page
- ✅ `userProfile` - for user profile
- ✅ `dashboardHome` - for dashboard home
- ✅ `teamMembers` - for team members page

## Additional Resources

- **📚 Examples**: See `examples.md` in this skill directory for comprehensive real-world examples
- Translation types: `src/lib/translations/types.ts`
- Translation hooks: `src/lib/translations/hooks.ts`
- Locale context: `src/lib/translations/locale-context.tsx`
- Auto-generated index: `src/lib/translations/index.ts` (DO NOT EDIT)
- Example files: Search for existing `@translations.ts` files in the codebase

## Proactive Application

**Apply this skill automatically when:**

- Creating new pages or components
- Modifying existing pages to add new text
- User asks to "add a page" or "create a component"
- Any task involving user-facing text

**Don't wait for the user to explicitly request translations—apply them proactively!**
