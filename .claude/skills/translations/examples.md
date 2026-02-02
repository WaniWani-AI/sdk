# Translation Examples

Real-world examples from the WaniWani codebase showing correct translation patterns.

## Example 1: Simple Page with Static Text

**File: `src/app/(app)/settings/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const settings = defineTranslations({
  en: {
    title: "Settings",
    description: "Manage your account settings and preferences",
    actions: {
      save: "Save Changes",
      cancel: "Cancel",
    },
  },
  fr: {
    title: "Paramètres",
    description: "Gérez vos paramètres de compte et préférences",
    actions: {
      save: "Enregistrer les modifications",
      cancel: "Annuler",
    },
  },
});
```

**Usage in component:**

```tsx
"use client";

import { useTranslation } from "@/lib/translations/hooks";

export function SettingsPage() {
  const t = useTranslation("settings");

  return (
    <div className="flex flex-col gap-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">{t.title}</h1>
        <p className="text-muted-foreground mt-2">{t.description}</p>
      </div>

      <div className="flex gap-2">
        <button>{t.actions.save}</button>
        <button>{t.actions.cancel}</button>
      </div>
    </div>
  );
}
```

## Example 2: Dynamic Content with Functions

**File: `src/app/(app)/teams/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const teams = defineTranslations({
  en: {
    title: "Teams",
    subtitle: ({ orgName }: { orgName: string }) =>
      `Manage team members for ${orgName}`,
    memberCount: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'member' : 'members'}`,
    roleUpdated: ({ userName, role }: { userName: string; role: string }) =>
      `${userName} is now ${role}`,
    invitedAt: ({ date }: { date: string }) =>
      `Invited on ${date}`,
  },
  fr: {
    title: "Équipes",
    subtitle: ({ orgName }: { orgName: string }) =>
      `Gérez les membres de l'équipe pour ${orgName}`,
    memberCount: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'membre' : 'membres'}`,
    roleUpdated: ({ userName, role }: { userName: string; role: string }) =>
      `${userName} est maintenant ${role}`,
    invitedAt: ({ date }: { date: string }) =>
      `Invité le ${date}`,
  },
});
```

**Usage in component:**

```tsx
"use client";

import { useTranslation } from "@/lib/translations/hooks";

export function TeamsPage({ org, members }) {
  const t = useTranslation("teams");

  return (
    <div>
      <h1>{t.title}</h1>
      <p>{t.subtitle({ orgName: org.name })}</p>
      <p>{t.memberCount({ count: members.length })}</p>

      {members.map(member => (
        <div key={member.id}>
          <span>{member.name}</span>
          <span>{t.invitedAt({ date: member.invitedAt })}</span>
        </div>
      ))}
    </div>
  );
}
```

## Example 3: Form with Validation Messages

**File: `src/app/(app)/profile/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const profile = defineTranslations({
  en: {
    title: "Profile",
    description: "Update your personal information",
    form: {
      firstName: "First Name",
      lastName: "Last Name",
      email: "Email Address",
      bio: "Bio",
      placeholders: {
        firstName: "Enter your first name",
        lastName: "Enter your last name",
        email: "your.email@example.com",
        bio: "Tell us about yourself...",
      },
    },
    validation: {
      required: ({ field }: { field: string }) => `${field} is required`,
      emailInvalid: "Please enter a valid email address",
      minLength: ({ field, min }: { field: string; min: number }) =>
        `${field} must be at least ${min} characters`,
    },
    messages: {
      saveSuccess: "Profile updated successfully",
      saveError: "Failed to update profile",
    },
  },
  fr: {
    title: "Profil",
    description: "Mettez à jour vos informations personnelles",
    form: {
      firstName: "Prénom",
      lastName: "Nom",
      email: "Adresse e-mail",
      bio: "Biographie",
      placeholders: {
        firstName: "Entrez votre prénom",
        lastName: "Entrez votre nom",
        email: "votre.email@example.com",
        bio: "Parlez-nous de vous...",
      },
    },
    validation: {
      required: ({ field }: { field: string }) => `${field} est requis`,
      emailInvalid: "Veuillez entrer une adresse e-mail valide",
      minLength: ({ field, min }: { field: string; min: number }) =>
        `${field} doit contenir au moins ${min} caractères`,
    },
    messages: {
      saveSuccess: "Profil mis à jour avec succès",
      saveError: "Échec de la mise à jour du profil",
    },
  },
});
```

**Usage in component:**

```tsx
"use client";

import { useTranslation } from "@/lib/translations/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export function ProfileForm() {
  const t = useTranslation("profile");
  const { register, handleSubmit, formState: { errors } } = useForm();

  const onSubmit = async (data) => {
    try {
      await updateProfile(data);
      toast.success(t.messages.saveSuccess);
    } catch (error) {
      toast.error(t.messages.saveError);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1>{t.title}</h1>
        <p>{t.description}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label>{t.form.firstName}</label>
          <input
            {...register("firstName", {
              required: t.validation.required({ field: t.form.firstName }),
              minLength: {
                value: 2,
                message: t.validation.minLength({ field: t.form.firstName, min: 2 }),
              },
            })}
            placeholder={t.form.placeholders.firstName}
          />
          {errors.firstName && <span>{errors.firstName.message}</span>}
        </div>

        <div>
          <label>{t.form.email}</label>
          <input
            type="email"
            {...register("email", {
              required: t.validation.required({ field: t.form.email }),
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: t.validation.emailInvalid,
              },
            })}
            placeholder={t.form.placeholders.email}
          />
          {errors.email && <span>{errors.email.message}</span>}
        </div>

        <button type="submit">Save</button>
      </form>
    </div>
  );
}
```

## Example 4: Table with Dynamic Headers

**File: `src/app/(app)/users/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const users = defineTranslations({
  en: {
    title: "Users",
    description: "Manage user accounts",
    table: {
      headers: {
        name: "Name",
        email: "Email",
        role: "Role",
        status: "Status",
        createdAt: "Created",
        actions: "Actions",
      },
      actions: {
        edit: "Edit",
        delete: "Delete",
        activate: "Activate",
        deactivate: "Deactivate",
      },
      status: {
        active: "Active",
        inactive: "Inactive",
        pending: "Pending",
      },
    },
    empty: {
      title: "No users found",
      description: "Get started by creating your first user",
      action: "Add User",
    },
    deleteConfirm: ({ userName }: { userName: string }) =>
      `Are you sure you want to delete ${userName}?`,
  },
  fr: {
    title: "Utilisateurs",
    description: "Gérez les comptes utilisateurs",
    table: {
      headers: {
        name: "Nom",
        email: "E-mail",
        role: "Rôle",
        status: "Statut",
        createdAt: "Créé",
        actions: "Actions",
      },
      actions: {
        edit: "Modifier",
        delete: "Supprimer",
        activate: "Activer",
        deactivate: "Désactiver",
      },
      status: {
        active: "Actif",
        inactive: "Inactif",
        pending: "En attente",
      },
    },
    empty: {
      title: "Aucun utilisateur trouvé",
      description: "Commencez par créer votre premier utilisateur",
      action: "Ajouter un utilisateur",
    },
    deleteConfirm: ({ userName }: { userName: string }) =>
      `Êtes-vous sûr de vouloir supprimer ${userName} ?`,
  },
});
```

**Usage in component:**

```tsx
"use client";

import { useTranslation } from "@/lib/translations/hooks";

export function UsersTable({ users }) {
  const t = useTranslation("users");

  if (users.length === 0) {
    return (
      <div className="text-center py-12">
        <h2>{t.empty.title}</h2>
        <p>{t.empty.description}</p>
        <button>{t.empty.action}</button>
      </div>
    );
  }

  return (
    <div>
      <h1>{t.title}</h1>
      <p>{t.description}</p>

      <table>
        <thead>
          <tr>
            <th>{t.table.headers.name}</th>
            <th>{t.table.headers.email}</th>
            <th>{t.table.headers.role}</th>
            <th>{t.table.headers.status}</th>
            <th>{t.table.headers.createdAt}</th>
            <th>{t.table.headers.actions}</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{t.table.status[user.status]}</td>
              <td>{user.createdAt}</td>
              <td>
                <button>{t.table.actions.edit}</button>
                <button
                  onClick={() => {
                    if (confirm(t.deleteConfirm({ userName: user.name }))) {
                      deleteUser(user.id);
                    }
                  }}
                >
                  {t.table.actions.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

## Example 5: Complex Nested Structure

**File: `src/app/(app)/dashboard/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const dashboard = defineTranslations({
  en: {
    title: "Dashboard",
    welcome: ({ userName }: { userName: string }) => `Welcome back, ${userName}!`,
    sections: {
      overview: {
        title: "Overview",
        stats: {
          totalUsers: "Total Users",
          activeProjects: "Active Projects",
          pendingTasks: "Pending Tasks",
          completedToday: "Completed Today",
        },
      },
      recentActivity: {
        title: "Recent Activity",
        empty: "No recent activity",
        types: {
          userCreated: ({ userName }: { userName: string }) =>
            `${userName} joined`,
          projectCreated: ({ projectName }: { projectName: string }) =>
            `New project: ${projectName}`,
          taskCompleted: ({ taskName }: { taskName: string }) =>
            `Completed: ${taskName}`,
        },
        timeAgo: {
          justNow: "Just now",
          minutesAgo: ({ minutes }: { minutes: number }) =>
            `${minutes}m ago`,
          hoursAgo: ({ hours }: { hours: number }) =>
            `${hours}h ago`,
          daysAgo: ({ days }: { days: number }) =>
            `${days}d ago`,
        },
      },
    },
  },
  fr: {
    title: "Tableau de bord",
    welcome: ({ userName }: { userName: string }) =>
      `Bienvenue, ${userName} !`,
    sections: {
      overview: {
        title: "Aperçu",
        stats: {
          totalUsers: "Utilisateurs totaux",
          activeProjects: "Projets actifs",
          pendingTasks: "Tâches en attente",
          completedToday: "Terminées aujourd'hui",
        },
      },
      recentActivity: {
        title: "Activité récente",
        empty: "Aucune activité récente",
        types: {
          userCreated: ({ userName }: { userName: string }) =>
            `${userName} a rejoint`,
          projectCreated: ({ projectName }: { projectName: string }) =>
            `Nouveau projet : ${projectName}`,
          taskCompleted: ({ taskName }: { taskName: string }) =>
            `Terminé : ${taskName}`,
        },
        timeAgo: {
          justNow: "À l'instant",
          minutesAgo: ({ minutes }: { minutes: number }) =>
            `Il y a ${minutes}m`,
          hoursAgo: ({ hours }: { hours: number }) =>
            `Il y a ${hours}h`,
          daysAgo: ({ days }: { days: number }) =>
            `Il y a ${days}j`,
        },
      },
    },
  },
});
```

## Example 6: API Error Translations (Shared)

**File: `src/lib/translations/@translations.ts`**

```typescript
import { defineTranslations } from "@/lib/translations/types";

export const errors = defineTranslations({
  en: {
    api: {
      // Generic errors
      UNKNOWN_ERROR: "An unknown error occurred",
      UNAUTHORIZED: "You must be logged in to perform this action",
      FORBIDDEN: "You don't have permission to perform this action",
      NOT_FOUND: "The requested resource was not found",

      // Organization errors
      ORG_NOT_FOUND: "Organization not found",
      ORG_NAME_REQUIRED: "Organization name is required",
      ORG_ALREADY_EXISTS: "An organization with this name already exists",

      // User errors
      USER_NOT_FOUND: "User not found",
      USER_ALREADY_IN_ORG: "User is already a member of this organization",
      USER_NOT_IN_ORG: "User is not a member of this organization",

      // Validation errors
      INVALID_EMAIL: "Invalid email address",
      INVALID_INPUT: "Invalid input provided",
    },
  },
  fr: {
    api: {
      // Generic errors
      UNKNOWN_ERROR: "Une erreur inconnue s'est produite",
      UNAUTHORIZED: "Vous devez être connecté pour effectuer cette action",
      FORBIDDEN: "Vous n'avez pas la permission d'effectuer cette action",
      NOT_FOUND: "La ressource demandée n'a pas été trouvée",

      // Organization errors
      ORG_NOT_FOUND: "Organisation introuvable",
      ORG_NAME_REQUIRED: "Le nom de l'organisation est requis",
      ORG_ALREADY_EXISTS: "Une organisation avec ce nom existe déjà",

      // User errors
      USER_NOT_FOUND: "Utilisateur introuvable",
      USER_ALREADY_IN_ORG: "L'utilisateur est déjà membre de cette organisation",
      USER_NOT_IN_ORG: "L'utilisateur n'est pas membre de cette organisation",

      // Validation errors
      INVALID_EMAIL: "Adresse e-mail invalide",
      INVALID_INPUT: "Entrée invalide fournie",
    },
  },
});
```

**Usage with API responses:**

```tsx
"use client";

import { useTranslation } from "@/lib/translations/hooks";
import { toast } from "sonner";

export function CreateOrgForm() {
  const t = useTranslation("errors");

  const handleSubmit = async (data) => {
    try {
      const response = await fetch("/api/orgs", {
        method: "POST",
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        // API returns error code like "ORG_ALREADY_EXISTS"
        // Translate it to user's language
        toast.error(t.api[result.message] || t.api.UNKNOWN_ERROR);
        return;
      }

      toast.success("Organization created!");
    } catch (error) {
      toast.error(t.api.UNKNOWN_ERROR);
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

## Key Patterns Summary

1. **Static text**: Use plain strings
2. **Dynamic text**: Use functions with object parameters `({ param }: { param: Type })`
3. **Nested organization**: Group related translations in objects
4. **Consistent structure**: All languages must have identical keys
5. **Type safety**: TypeScript enforces matching structures across languages
6. **API errors**: Use shared error translations in `src/lib/translations/@translations.ts`
7. **Empty states**: Always translate empty state messages
8. **Validation**: Translate all form validation messages
9. **Actions**: Group button/action text together
10. **Time formatting**: Use functions for relative time displays
