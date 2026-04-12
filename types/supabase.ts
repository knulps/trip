// Supabase 프로젝트 연결 후 자동 생성하려면:
// npx supabase gen types typescript --project-id <your-project-id> > types/supabase.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      trips: {
        Row: {
          id: string
          name: string
          start_date: string
          end_date: string
          created_by: string
          invite_token: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          start_date: string
          end_date: string
          created_by: string
          invite_token?: string
          created_at?: string
        }
        Update: {
          name?: string
          start_date?: string
          end_date?: string
          invite_token?: string
        }
        Relationships: []
      }
      trip_members: {
        Row: {
          trip_id: string
          user_id: string
          role: 'owner' | 'member'
          joined_at: string
        }
        Insert: {
          trip_id: string
          user_id: string
          role?: 'owner' | 'member'
          joined_at?: string
        }
        Update: {
          role?: 'owner' | 'member'
        }
        Relationships: [
          {
            foreignKeyName: 'trip_members_trip_id_fkey'
            columns: ['trip_id']
            referencedRelation: 'trips'
            referencedColumns: ['id']
          }
        ]
      }
      days: {
        Row: {
          id: string
          trip_id: string
          date: string
        }
        Insert: {
          id?: string
          trip_id: string
          date: string
        }
        Update: {
          date?: string
        }
        Relationships: [
          {
            foreignKeyName: 'days_trip_id_fkey'
            columns: ['trip_id']
            referencedRelation: 'trips'
            referencedColumns: ['id']
          }
        ]
      }
      places: {
        Row: {
          id: string
          day_id: string
          order_key: string
          name: string
          lat: number
          lng: number
          address: string
          visit_time: string | null
          memo: string | null
          created_at: string
        }
        Insert: {
          id?: string
          day_id: string
          order_key: string
          name: string
          lat: number
          lng: number
          address: string
          visit_time?: string | null
          memo?: string | null
          created_at?: string
        }
        Update: {
          order_key?: string
          name?: string
          lat?: number
          lng?: number
          address?: string
          visit_time?: string | null
          memo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'places_day_id_fkey'
            columns: ['day_id']
            referencedRelation: 'days'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Trip = Database['public']['Tables']['trips']['Row']
export type TripMember = Database['public']['Tables']['trip_members']['Row']
export type Day = Database['public']['Tables']['days']['Row']
export type Place = Database['public']['Tables']['places']['Row']
