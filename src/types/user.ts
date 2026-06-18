export type UserRole = 'board' | 'manager' | 'expert';

export interface User {
    id: string;

    firstName: string;
    lastName: string;
    fullName: string;

    username: string;
    email: string;

    role: UserRole;
    isActive: boolean;

    createdAt: string;
    updatedAt: string;
}