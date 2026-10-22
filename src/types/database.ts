export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      property_history: {
        Row: {
          id: string;
          property_id: string;
          actor_id: string;
          actor_name: string;
          occurred_at: string;
          target: string;
          target_id: string;
          changed_fields: string[];
          before_values: Json;
          after_values: Json;
          explanation: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      property_status_changes: {
        Row: {
          id: string;
          property_id: string;
          origin: string;
          state: string;
          from_status: string;
          to_status: string;
          requested_by: string;
          requested_by_name: string;
          requested_at: string;
          note: string | null;
          decided_by: string | null;
          decided_by_name: string | null;
          decided_at: string | null;
          decision_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'property_status_changes_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_status_changes_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_status_changes_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      property_comment_removals: {
        Row: {
          author_id: string;
          author_name: string;
          body: string;
          comment_id: string;
          original_created_at: string;
          original_revision: string;
          property_id: string;
          removal_kind: string;
          removal_reason: string | null;
          removed_actor_name: string;
          removed_at: string;
          removed_by: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      property_comment_edits: {
        Row: {
          author_id: string;
          author_name: string;
          body: string;
          comment_id: string;
          edited_actor_name: string;
          edited_at: string;
          edited_by: string;
          edit_key: string;
          id: string;
          previous_body: string;
          previous_revision: string;
          property_id: string;
          revision: string;
          version: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      property_comments: {
        Row: {
          author_id: string;
          author_name: string;
          body: string | null;
          created_at: string;
          edited_at: string | null;
          id: string;
          idempotency_key: string;
          property_id: string;
          removed_at: string | null;
          revision: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      correction_requests: {
        Row: {
          id: string;
          property_id: string;
          requester_id: string;
          target: string;
          target_id: string | null;
          category: string;
          explanation: string;
          proposed_values: Json;
          observed_values: Json;
          observed_revision: string;
          property_revision: string;
          created_at: string;
          revision: string;
          status: string;
          outcome_actor_id: string | null;
          outcome_at: string | null;
          outcome_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      correction_amendments: {
        Row: {
          id: string;
          request_id: string;
          actor_id: string;
          explanation: string;
          proposed_values: Json;
          observed_values: Json;
          observed_revision: string;
          property_revision: string;
          created_at: string;
          ordinal: number;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'correction_amendments_request_id_fkey';
            columns: ['request_id'];
            isOneToOne: false;
            referencedRelation: 'correction_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      activity_events: {
        Row: {
          business_day: string | null;
          employee_id: string;
          id: string;
          idempotency_key: string;
          kind: string;
          notes: string | null;
          occurred_at: string;
          property_id: string;
          recorded_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string;
          visit_status: string | null;
        };
        Insert: {
          business_day?: string | null;
          employee_id: string;
          id?: string;
          idempotency_key: string;
          kind: string;
          notes?: string | null;
          occurred_at?: string;
          property_id: string;
          recorded_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
          visit_status?: string | null;
        };
        Update: {
          business_day?: string | null;
          employee_id?: string;
          id?: string;
          idempotency_key?: string;
          kind?: string;
          notes?: string | null;
          occurred_at?: string;
          property_id?: string;
          recorded_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
          visit_status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_events_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_events_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'activity_events_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_events_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_events_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      admin_unit_crosswalks: {
        Row: {
          effective_on: string;
          from_unit_id: string;
          id: string;
          relation: string;
          resolution_notes: string | null;
          source_attested: boolean;
          source_url: string;
          to_unit_id: string;
          verified_by: string | null;
        };
        Insert: {
          effective_on: string;
          from_unit_id: string;
          id?: string;
          relation: string;
          resolution_notes?: string | null;
          source_attested?: boolean;
          source_url: string;
          to_unit_id: string;
          verified_by?: string | null;
        };
        Update: {
          effective_on?: string;
          from_unit_id?: string;
          id?: string;
          relation?: string;
          resolution_notes?: string | null;
          source_attested?: boolean;
          source_url?: string;
          to_unit_id?: string;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_unit_crosswalks_from_unit_id_fkey';
            columns: ['from_unit_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_unit_crosswalks_to_unit_id_fkey';
            columns: ['to_unit_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_unit_crosswalks_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_unit_crosswalks_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      admin_unit_versions: {
        Row: {
          id: string;
          name_vi: string;
          official_code: string;
          parent_id: string | null;
          source_url: string;
          unit_level: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          id?: string;
          name_vi: string;
          official_code: string;
          parent_id?: string | null;
          source_url: string;
          unit_level: string;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          id?: string;
          name_vi?: string;
          official_code?: string;
          parent_id?: string | null;
          source_url?: string;
          unit_level?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_unit_versions_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      contacts: {
        Row: {
          contact_type: string;
          created_at: string;
          display_name: string;
          id: string;
          notes: string | null;
          phones: string[];
          raw_phone_text: string | null;
          revision: string;
        };
        Insert: {
          contact_type?: string;
          created_at?: string;
          display_name: string;
          id?: string;
          notes?: string | null;
          phones?: string[];
          raw_phone_text?: string | null;
          revision?: string;
        };
        Update: {
          contact_type?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          notes?: string | null;
          phones?: string[];
          raw_phone_text?: string | null;
          revision?: string;
        };
        Relationships: [];
      };
      vendors: {
        Row: {
          contact_name: string | null;
          created_at: string;
          created_by: string;
          display_name: string;
          email: string | null;
          id: string;
          notes: string | null;
          phones: string[] | null;
          search_text: string;
          source_address: string | null;
          submission_key: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'vendors_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      document_categories: {
        Row: {
          builtin: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
        };
        Insert: {
          builtin?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          builtin?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_categories_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'document_categories_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      employees: {
        Row: {
          access_revision: number;
          account_deleted_at: string | null;
          auth_user_id: string | null;
          bio: string | null;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          is_active: boolean;
          phone: string | null;
          preferred_locale: string;
          role: string;
        };
        Insert: {
          access_revision?: number;
          account_deleted_at?: string | null;
          auth_user_id?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name: string;
          email: string;
          id?: string;
          is_active?: boolean;
          phone?: string | null;
          preferred_locale?: string;
          role?: string;
        };
        Update: {
          access_revision?: number;
          account_deleted_at?: string | null;
          auth_user_id?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string;
          email?: string;
          id?: string;
          is_active?: boolean;
          phone?: string | null;
          preferred_locale?: string;
          role?: string;
        };
        Relationships: [];
      };
      employee_admin_operations: {
        Row: {
          actor_id: string;
          completed_at: string | null;
          created_at: string;
          employee_id: string;
          id: string;
          idempotency_key: string;
          kind: string;
          membership_disabled_at: string;
          provider_attempted_at: string | null;
          provider_ban_until: string | null;
          provider_detail: string | null;
          provider_outcome: string | null;
          provider_reference: string | null;
          provider_user_id: string | null;
          revision: number;
          state: string;
          storage_owned_count: number | null;
          storage_reassigned_count: number | null;
          target_auth_user_id: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'employee_admin_operations_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_admin_operations_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      employee_admin_events: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          detail: string | null;
          employee_id: string;
          id: string;
          idempotency_key: string | null;
          operation_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'employee_admin_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_admin_events_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_admin_events_operation_id_fkey';
            columns: ['operation_id'];
            isOneToOne: false;
            referencedRelation: 'employee_admin_operations';
            referencedColumns: ['id'];
          },
        ];
      };
      employee_invitations: {
        Row: {
          actor_id: string;
          created_at: string;
          email: string;
          employee_id: string;
          id: string;
          idempotency_key: string;
          provider_attempted_at: string | null;
          provider_detail: string | null;
          provider_outcome: string | null;
          provider_user_id: string | null;
          recorded_at: string | null;
          requested_at: string;
          resend_actor_id: string | null;
          resend_attempted_at: string | null;
          resend_count: number;
          resend_detail: string | null;
          resend_outcome: string | null;
          revision: number;
          role: string;
          state: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'employee_invitations_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_invitations_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      lock_events: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: number;
          lock_id: string;
          reason: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          lock_id: string;
          reason?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          lock_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lock_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lock_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'lock_events_lock_id_fkey';
            columns: ['lock_id'];
            isOneToOne: false;
            referencedRelation: 'property_locks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lock_events_lock_id_fkey';
            columns: ['lock_id'];
            isOneToOne: false;
            referencedRelation: 'v_effective_property_locks';
            referencedColumns: ['id'];
          },
        ];
      };
      properties: {
        Row: {
          access_type: string;
          archived_at: string | null;
          area_raw: string | null;
          bathrooms: number | null;
          bedrooms: number | null;
          construction_text: string | null;
          cover_file_id: string | null;
          created_at: string;
          created_by: string | null;
          depth_m: number | null;
          direction: string | null;
          entry_on: string | null;
          entry_source: string;
          floor_area_m2: number | null;
          floors: number | null;
          frontage_m: number | null;
          id: string;
          land_area_m2: number | null;
          latitude: number | null;
          legal_status: string;
          listing_mode: string;
          longitude: number | null;
          map_sheet_number: string | null;
          monthly_rent_vnd: number | null;
          notes: string | null;
          ownership_type: string | null;
          parcel_number: string | null;
          property_code: string;
          property_type: string;
          record_review_status: string;
          revision: string;
          sale_price_vnd: number | null;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          access_type?: string;
          archived_at?: string | null;
          area_raw?: string | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          construction_text?: string | null;
          cover_file_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          depth_m?: number | null;
          direction?: string | null;
          entry_on?: string | null;
          entry_source?: string;
          floor_area_m2?: number | null;
          floors?: number | null;
          frontage_m?: number | null;
          id?: string;
          land_area_m2?: number | null;
          latitude?: number | null;
          legal_status?: string;
          listing_mode: string;
          longitude?: number | null;
          map_sheet_number?: string | null;
          monthly_rent_vnd?: number | null;
          notes?: string | null;
          ownership_type?: string | null;
          parcel_number?: string | null;
          property_code: string;
          property_type?: string;
          record_review_status?: string;
          revision?: string;
          sale_price_vnd?: number | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          access_type?: string;
          archived_at?: string | null;
          area_raw?: string | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          construction_text?: string | null;
          cover_file_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          depth_m?: number | null;
          direction?: string | null;
          entry_on?: string | null;
          entry_source?: string;
          floor_area_m2?: number | null;
          floors?: number | null;
          frontage_m?: number | null;
          id?: string;
          land_area_m2?: number | null;
          latitude?: number | null;
          legal_status?: string;
          listing_mode?: string;
          longitude?: number | null;
          map_sheet_number?: string | null;
          monthly_rent_vnd?: number | null;
          notes?: string | null;
          ownership_type?: string | null;
          parcel_number?: string | null;
          property_code?: string;
          property_type?: string;
          record_review_status?: string;
          revision?: string;
          sale_price_vnd?: number | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_cover_file_id_fkey';
            columns: ['cover_file_id'];
            isOneToOne: false;
            referencedRelation: 'property_files';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'properties_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      property_addresses: {
        Row: {
          address_text: string;
          commune_text: string | null;
          commune_unit_id: string | null;
          created_at: string;
          district_text: string | null;
          district_unit_id: string | null;
          effective_on: string | null;
          format: string;
          house_number: string | null;
          id: string;
          is_primary: boolean;
          mapping_status: string;
          mapping_evidence: string | null;
          revision: string;
          supersedes_address_id: string | null;
          property_id: string;
          province_text: string | null;
          province_unit_id: string | null;
          search_text: string;
          source_url: string | null;
          street: string | null;
          verification_method: string | null;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          address_text: string;
          commune_text?: string | null;
          commune_unit_id?: string | null;
          created_at?: string;
          district_text?: string | null;
          district_unit_id?: string | null;
          effective_on?: string | null;
          format: string;
          house_number?: string | null;
          id?: string;
          is_primary?: boolean;
          mapping_status?: string;
          mapping_evidence?: string | null;
          revision?: string;
          supersedes_address_id?: string | null;
          property_id: string;
          province_text?: string | null;
          province_unit_id?: string | null;
          search_text?: string;
          source_url?: string | null;
          street?: string | null;
          verification_method?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          address_text?: string;
          commune_text?: string | null;
          commune_unit_id?: string | null;
          created_at?: string;
          district_text?: string | null;
          district_unit_id?: string | null;
          effective_on?: string | null;
          format?: string;
          house_number?: string | null;
          id?: string;
          is_primary?: boolean;
          mapping_status?: string;
          mapping_evidence?: string | null;
          revision?: string;
          supersedes_address_id?: string | null;
          property_id?: string;
          province_text?: string | null;
          province_unit_id?: string | null;
          search_text?: string;
          source_url?: string | null;
          street?: string | null;
          verification_method?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_addresses_commune_unit_id_fkey';
            columns: ['commune_unit_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_addresses_district_unit_id_fkey';
            columns: ['district_unit_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_addresses_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_addresses_province_unit_id_fkey';
            columns: ['province_unit_id'];
            isOneToOne: false;
            referencedRelation: 'admin_unit_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_addresses_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_addresses_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      property_contacts: {
        Row: {
          contact_id: string;
          is_primary: boolean;
          property_id: string;
          relation: string;
          revision: string;
        };
        Insert: {
          contact_id: string;
          is_primary?: boolean;
          property_id: string;
          relation?: string;
          revision?: string;
        };
        Update: {
          contact_id?: string;
          is_primary?: boolean;
          property_id?: string;
          relation?: string;
          revision?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_contacts_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_contacts_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_vendors: {
        Row: {
          created_at: string;
          created_by: string;
          property_id: string;
          revision: string;
          vendor_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'property_vendors_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_vendors_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_vendors_vendor_id_fkey';
            columns: ['vendor_id'];
            isOneToOne: false;
            referencedRelation: 'vendors';
            referencedColumns: ['id'];
          },
        ];
      };
      property_files: {
        Row: {
          bucket_id: string;
          category_id: string;
          created_at: string;
          document_type: string;
          id: string;
          mime_type: string | null;
          object_path: string;
          original_filename: string;
          property_id: string;
          purpose: string;
          review_status: string;
          reviewed_by: string | null;
          sha256: string | null;
          size_bytes: number | null;
          upload_status: string;
          uploaded_by: string | null;
          validated_at: string | null;
          validated_object_id: string | null;
        };
        Insert: {
          bucket_id?: string;
          category_id?: string;
          created_at?: string;
          document_type: string;
          id?: string;
          mime_type?: string | null;
          object_path: string;
          original_filename: string;
          property_id: string;
          purpose?: string;
          review_status?: string;
          reviewed_by?: string | null;
          sha256?: string | null;
          size_bytes?: number | null;
          upload_status?: string;
          uploaded_by?: string | null;
          validated_at?: string | null;
          validated_object_id?: string | null;
        };
        Update: {
          bucket_id?: string;
          category_id?: string;
          created_at?: string;
          document_type?: string;
          id?: string;
          mime_type?: string | null;
          object_path?: string;
          original_filename?: string;
          property_id?: string;
          purpose?: string;
          review_status?: string;
          reviewed_by?: string | null;
          sha256?: string | null;
          size_bytes?: number | null;
          upload_status?: string;
          uploaded_by?: string | null;
          validated_at?: string | null;
          validated_object_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_files_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'document_categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_files_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_files_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_files_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'property_files_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_files_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      property_locks: {
        Row: {
          attribution_reference: string | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          evidence_file_id: string | null;
          expires_at: string;
          id: string;
          property_id: string;
          reason: string;
          released_at: string | null;
          requested_at: string;
          requested_by: string;
          status: string;
        };
        Insert: {
          attribution_reference?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          evidence_file_id?: string | null;
          expires_at?: string;
          id?: string;
          property_id: string;
          reason: string;
          released_at?: string | null;
          requested_at?: string;
          requested_by: string;
          status?: string;
        };
        Update: {
          attribution_reference?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          evidence_file_id?: string | null;
          expires_at?: string;
          id?: string;
          property_id?: string;
          reason?: string;
          released_at?: string | null;
          requested_at?: string;
          requested_by?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_locks_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'property_locks_evidence_file_id_fkey';
            columns: ['evidence_file_id'];
            isOneToOne: false;
            referencedRelation: 'property_files';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      rental_agreements: {
        Row: {
          actual_ends_on: string | null;
          approved_at: string | null;
          approved_by: string | null;
          close_reason: string | null;
          closed_at: string | null;
          closed_by: string | null;
          contract_code: string;
          contract_language: string;
          created_at: string;
          created_by: string;
          due_day: number;
          ends_on: string;
          id: string;
          monthly_rent_vnd: number;
          property_id: string;
          proration_method: string;
          starts_on: string;
          status: string;
          tenant_contact_id: string;
        };
        Insert: {
          actual_ends_on?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          contract_code: string;
          contract_language?: string;
          created_at?: string;
          created_by: string;
          due_day?: number;
          ends_on: string;
          id?: string;
          monthly_rent_vnd: number;
          property_id: string;
          proration_method?: string;
          starts_on: string;
          status?: string;
          tenant_contact_id: string;
        };
        Update: {
          actual_ends_on?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          contract_code?: string;
          contract_language?: string;
          created_at?: string;
          created_by?: string;
          due_day?: number;
          ends_on?: string;
          id?: string;
          monthly_rent_vnd?: number;
          property_id?: string;
          proration_method?: string;
          starts_on?: string;
          status?: string;
          tenant_contact_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rental_agreements_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_tenant_contact_id_fkey';
            columns: ['tenant_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      rental_months: {
        Row: {
          agreement_id: string;
          amount_due_vnd: number;
          due_on: string;
          id: string;
          month_start: string;
          occupied_from: string;
          occupied_to: string;
          status: string;
        };
        Insert: {
          agreement_id: string;
          amount_due_vnd: number;
          due_on: string;
          id?: string;
          month_start: string;
          occupied_from: string;
          occupied_to: string;
          status?: string;
        };
        Update: {
          agreement_id?: string;
          amount_due_vnd?: number;
          due_on?: string;
          id?: string;
          month_start?: string;
          occupied_from?: string;
          occupied_to?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rental_months_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'rental_agreements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_months_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'v_rental_property_status';
            referencedColumns: ['id'];
          },
        ];
      };
      rental_payments: {
        Row: {
          amount_vnd: number;
          decision_reason: string | null;
          evidence_file_id: string | null;
          external_reference: string | null;
          id: string;
          idempotency_key: string;
          kind: string;
          method: string;
          paid_on: string;
          recorded_at: string;
          recorded_by: string;
          rental_month_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
        };
        Insert: {
          amount_vnd: number;
          decision_reason?: string | null;
          evidence_file_id?: string | null;
          external_reference?: string | null;
          id?: string;
          idempotency_key: string;
          kind: string;
          method: string;
          paid_on: string;
          recorded_at?: string;
          recorded_by: string;
          rental_month_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
        };
        Update: {
          amount_vnd?: number;
          decision_reason?: string | null;
          evidence_file_id?: string | null;
          external_reference?: string | null;
          id?: string;
          idempotency_key?: string;
          kind?: string;
          method?: string;
          paid_on?: string;
          recorded_at?: string;
          recorded_by?: string;
          rental_month_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rental_payments_evidence_file_id_fkey';
            columns: ['evidence_file_id'];
            isOneToOne: false;
            referencedRelation: 'property_files';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_payments_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_payments_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_payments_rental_month_id_fkey';
            columns: ['rental_month_id'];
            isOneToOne: false;
            referencedRelation: 'rental_months';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_payments_rental_month_id_fkey';
            columns: ['rental_month_id'];
            isOneToOne: false;
            referencedRelation: 'v_rental_month_status';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_payments_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_payments_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      sale_completions: {
        Row: {
          completed_on: string;
          confirmed_at: string;
          confirmed_by: string;
          credited_employee_id: string;
          id: string;
          idempotency_key: string;
          previous_status: string;
          property_id: string;
          reference: string;
          reversal_reason: string | null;
          reversed_at: string | null;
          reversed_by: string | null;
          version: number;
        };
        Insert: {
          completed_on: string;
          confirmed_at?: string;
          confirmed_by: string;
          credited_employee_id: string;
          id?: string;
          idempotency_key: string;
          previous_status: string;
          property_id: string;
          reference: string;
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          version?: number;
        };
        Update: {
          completed_on?: string;
          confirmed_at?: string;
          confirmed_by?: string;
          credited_employee_id?: string;
          id?: string;
          idempotency_key?: string;
          previous_status?: string;
          property_id?: string;
          reference?: string;
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'sale_completions_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_completions_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'sale_completions_credited_employee_id_fkey';
            columns: ['credited_employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_completions_credited_employee_id_fkey';
            columns: ['credited_employee_id'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'sale_completions_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_completions_reversed_by_fkey';
            columns: ['reversed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_completions_reversed_by_fkey';
            columns: ['reversed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
    };
    Views: {
      property_price_history: {
        Row: {
          actor_id: string | null;
          actor_name: string | null;
          after_value: string | null;
          before_value: string | null;
          explanation: string | null;
          id: string | null;
          occurred_at: string | null;
          property_id: string | null;
          series: string | null;
        };
        Relationships: [];
      };
      v_admin_inventory_by_area: {
        Row: {
          available_count: number | null;
          current_commune_id: string | null;
          current_commune_label: string | null;
          inventory_count: number | null;
          legacy_district_label: string | null;
          province_label: string | null;
          reserved_count: number | null;
          sold_count: number | null;
          unlocked_available_count: number | null;
        };
        Relationships: [];
      };
      v_admin_locks_by_employee: {
        Row: {
          display_name: string | null;
          effective_lock_count: number | null;
          employee_id: string | null;
        };
        Relationships: [];
      };
      v_effective_property_locks: {
        Row: {
          attribution_reference: string | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          employee_name: string | null;
          evidence_file_id: string | null;
          expires_at: string | null;
          id: string | null;
          property_id: string | null;
          reason: string | null;
          released_at: string | null;
          requested_at: string | null;
          requested_by: string | null;
          status: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_locks_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'property_locks_evidence_file_id_fkey';
            columns: ['evidence_file_id'];
            isOneToOne: false;
            referencedRelation: 'property_files';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_locks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      v_employee_daily_activity: {
        Row: {
          business_day: string | null;
          distinct_properties_viewed: number | null;
          employee_id: string | null;
          owner_contact_properties: number | null;
          page_view_events: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_events_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_events_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
        ];
      };
      v_rental_month_status: {
        Row: {
          agreement_id: string | null;
          amount_due_vnd: number | null;
          balance_due_vnd: number | null;
          contract_code: string | null;
          due_on: string | null;
          id: string | null;
          is_active_month: boolean | null;
          is_overdue: boolean | null;
          month_phase: string | null;
          month_start: string | null;
          net_paid_vnd: number | null;
          occupied_days: number | null;
          occupied_from: string | null;
          occupied_to: string | null;
          payment_status: string | null;
          property_id: string | null;
          refund_due_vnd: number | null;
          status: string | null;
          tenant_contact_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rental_agreements_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_tenant_contact_id_fkey';
            columns: ['tenant_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_months_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'rental_agreements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_months_agreement_id_fkey';
            columns: ['agreement_id'];
            isOneToOne: false;
            referencedRelation: 'v_rental_property_status';
            referencedColumns: ['id'];
          },
        ];
      };
      v_rental_property_status: {
        Row: {
          actual_ends_on: string | null;
          approved_at: string | null;
          approved_by: string | null;
          close_reason: string | null;
          closed_at: string | null;
          closed_by: string | null;
          contract_code: string | null;
          contract_language: string | null;
          created_at: string | null;
          created_by: string | null;
          due_day: number | null;
          ends_on: string | null;
          id: string | null;
          monthly_rent_vnd: number | null;
          occupancy_status: string | null;
          property_id: string | null;
          proration_method: string | null;
          starts_on: string | null;
          status: string | null;
          tenant_contact_id: string | null;
        };
        Insert: {
          actual_ends_on?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          contract_code?: string | null;
          contract_language?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          due_day?: number | null;
          ends_on?: string | null;
          id?: string | null;
          monthly_rent_vnd?: number | null;
          occupancy_status?: never;
          property_id?: string | null;
          proration_method?: string | null;
          starts_on?: string | null;
          status?: string | null;
          tenant_contact_id?: string | null;
        };
        Update: {
          actual_ends_on?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          contract_code?: string | null;
          contract_language?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          due_day?: number | null;
          ends_on?: string | null;
          id?: string | null;
          monthly_rent_vnd?: number | null;
          occupancy_status?: never;
          property_id?: string | null;
          proration_method?: string | null;
          starts_on?: string | null;
          status?: string | null;
          tenant_contact_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rental_agreements_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'v_admin_locks_by_employee';
            referencedColumns: ['employee_id'];
          },
          {
            foreignKeyName: 'rental_agreements_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rental_agreements_tenant_contact_id_fkey';
            columns: ['tenant_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      add_property_contact: {
        Args: { p_property_id: string; p_changes: Json };
        Returns: string;
      };
      begin_employee_account_deletion: {
        Args: { p_employee_id: string; p_key: string };
        Returns: Json;
      };
      begin_employee_deactivation: {
        Args: { p_employee_id: string; p_key: string };
        Returns: Json;
      };
      begin_employee_invitation: {
        Args: { p_email: string; p_role: string; p_key: string };
        Returns: Json;
      };
      accept_employee_invitation: {
        Args: {
          p_invitation_id: string;
          p_revision: number;
          p_display_name: string;
        };
        Returns: Json;
      };
      record_employee_invitation_result: {
        Args: {
          p_invitation_id: string;
          p_revision: number;
          p_actor_id: string;
          p_email: string;
          p_outcome: string;
          p_provider_user_id?: string | null;
          p_detail?: string | null;
        };
        Returns: Json;
      };
      resend_employee_invitation: {
        Args: {
          p_invitation_id: string;
          p_resend_count: number;
          p_outcome: string;
          p_detail?: string | null;
          p_provider_user_id?: string | null;
        };
        Returns: Json;
      };
      record_employee_invitation_proof: {
        Args: {
          p_invitation_id: string;
          p_auth_user_id: string;
          p_revision: number;
        };
        Returns: Json;
      };
      employee_invitation_proof_valid: {
        Args: { p_invitation_id: string; p_auth_user_id: string };
        Returns: boolean;
      };
      employee_storage_preflight: {
        Args: { p_auth_user_id: string };
        Returns: Json;
      };
      reassign_employee_storage_ownership: {
        Args: { p_from_auth_user_id: string; p_to_auth_user_id: string };
        Returns: Json;
      };
      record_employee_account_deletion_result: {
        Args: {
          p_operation_id: string;
          p_revision: number;
          p_actor_id: string;
          p_auth_user_id: string;
          p_outcome: string;
          p_provider_reference?: string | null;
          p_storage_owned?: number | null;
          p_storage_reassigned?: number | null;
          p_detail?: string | null;
        };
        Returns: Json;
      };
      record_employee_deactivation_result: {
        Args: {
          p_operation_id: string;
          p_revision: number;
          p_actor_id: string;
          p_auth_user_id: string;
          p_outcome: string;
          p_provider_reference?: string | null;
          p_detail?: string | null;
          p_ban_until?: string | null;
        };
        Returns: Json;
      };
      create_property: {
        Args: { p_mode: string; p_facts: Json; p_address: Json };
        Returns: string;
      };
      maintain_contact: {
        Args: {
          p_changes: Json;
          p_contact_id: string;
          p_expected_revision: string;
        };
        Returns: string;
      };
      maintain_property: {
        Args: {
          p_property_id: string;
          p_target: string;
          p_target_id: string | null;
          p_expected_revision: string;
          p_changes: Json;
          p_property_revision: string;
          p_explanation?: string | null;
        };
        Returns: string;
      };
      property_address_group: {
        Args: { p_property_id: string };
        Returns: Json;
      };
      merge_address_properties: {
        Args: {
          p_keep_property_id: string;
          p_merge_property_ids: string[];
          p_moved_object_ids?: string[];
          p_move_signature?: string | null;
        };
        Returns: Json;
      };
      create_contact: { Args: { p_changes: Json }; Returns: string };
      record_address_candidate: {
        Args: {
          p_property_id: string;
          p_legacy_address_id: string;
          p_property_revision: string;
        };
        Returns: string;
      };
      convert_address_format: {
        Args: {
          p_property_id: string;
          p_address_id: string;
          p_address_revision: string;
          p_property_revision: string;
        };
        Returns: string;
      };
      contact_impact: { Args: { p_contact_id: string }; Returns: Json };
      submit_correction: {
        Args: {
          p_property_id: string;
          p_target: string;
          p_target_id: string | null;
          p_category: string;
          p_explanation: string;
          p_changes: Json;
          p_revision: string;
          p_property_revision: string;
        };
        Returns: string;
      };
      amend_correction: {
        Args: {
          p_request_id: string;
          p_request_revision: string;
          p_explanation: string;
          p_changes: Json;
          p_revision: string;
          p_property_revision: string;
        };
        Returns: undefined;
      };
      decide_correction: {
        Args: {
          p_request_id: string;
          p_request_revision: string;
          p_action: string;
          p_reason: string | null;
          p_changes?: Json;
        };
        Returns: undefined;
      };
      activate_rental_agreement: {
        Args: { p_agreement_id: string };
        Returns: undefined;
      };
      close_rental_agreement: {
        Args: {
          p_agreement_id: string;
          p_end_on: string;
          p_reason: string;
          p_status: string;
        };
        Returns: undefined;
      };
      complete_property_upload: {
        Args: {
          p_file_id: string;
          p_mime_type: string;
          p_object_id: string;
          p_sha256: string;
          p_signature: string;
          p_size_bytes: number;
        };
        Returns: undefined;
      };
      create_or_get_category: { Args: { p_name: string }; Returns: string };
      create_rental_agreement: {
        Args: {
          p_code: string;
          p_due_day?: number;
          p_end: string;
          p_language?: string;
          p_property_id: string;
          p_proration?: string;
          p_rent: number;
          p_start: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      create_vendor: {
        Args: {
          p_contact_name?: string | null;
          p_display_name: string;
          p_email?: string | null;
          p_key: string;
          p_notes?: string | null;
          p_phones?: string[] | null;
          p_source_address?: string | null;
        };
        Returns: Json;
      };
      decide_property_lock: {
        Args: {
          p_approve: boolean;
          p_days?: number;
          p_lock_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      decide_rental_payment: {
        Args: { p_action: string; p_payment_id: string; p_reason: string };
        Returns: undefined;
      };
      decide_status_request: {
        Args: { p_approve: boolean; p_change_id: string; p_reason: string };
        Returns: Json;
      };
      fail_property_upload: { Args: { p_file_id: string }; Returns: boolean };
      mark_upload_cleaned: { Args: { p_file_id: string }; Returns: undefined };
      employee_owner_contact_ranking: {
        Args: { p_from: string; p_to: string };
        Returns: {
          employee_active: boolean;
          employee_id: string;
          employee_name: string;
          owner_contact_properties: number;
          rank_position: number;
        }[];
      };
      list_document_categories: {
        Args: never;
        Returns: {
          builtin: string;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
        }[];
      };
      list_property_comments: {
        Args: {
          p_before_created_at?: string;
          p_before_id?: string;
          p_limit?: number;
          p_property_id: string;
        };
        Returns: {
          author_id: string;
          author_name: string;
          body: string | null;
          created_at: string;
          edited_at: string | null;
          id: string;
          property_id: string;
          removed_at: string | null;
          revision: string;
        }[];
      };
      list_contacts: {
        Args: {
          p_after_id?: string;
          p_limit?: number;
          p_owners_only?: boolean;
          p_query?: string;
        };
        Returns: {
          contact_type: string;
          display_name: string;
          id: string;
          links: Json;
          phones: string[];
          raw_phone_text: string | null;
          revision: string;
        }[];
      };
      list_property_comment_history: {
        Args: { p_comment_id: string; p_property_id: string };
        Returns: {
          actor_id: string;
          actor_name: string;
          body: string;
          event_kind: string;
          has_more: boolean;
          occurred_at: string;
          reason: string | null;
          removal_kind: string | null;
          version: number | null;
        }[];
      };
      list_employee_names: {
        Args: { p_ids: string[] };
        Returns: { display_name: string; id: string }[];
      };
      list_employee_credit_options: {
        Args: never;
        Returns: {
          account_deleted_at: string | null;
          auth_user_id: string | null;
          display_name: string;
          id: string;
          is_active: boolean;
        }[];
      };
      list_vendors: {
        Args: {
          p_before_created_at?: string;
          p_before_id?: string;
          p_limit?: number;
          p_query?: string;
        };
        Returns: {
          contact_name: string | null;
          created_at: string;
          created_by: string;
          display_name: string;
          email: string | null;
          id: string;
          notes: string | null;
          phones: string[] | null;
          source_address: string | null;
        }[];
      };
      list_property_vendors: {
        Args: { p_property_id: string };
        Returns: {
          contact_name: string | null;
          created_at: string;
          display_name: string;
          email: string | null;
          phones: string[] | null;
          revision: string;
          vendor_id: string;
        }[];
      };
      list_vendor_properties: {
        Args: { p_vendor_id: string; p_limit?: number };
        Returns: {
          archived_at: string | null;
          linked_at: string;
          listing_mode: string;
          property_code: string;
          property_id: string;
          status: string;
        }[];
      };
      link_property_vendor: {
        Args: {
          p_expected_property_revision: string;
          p_property_id: string;
          p_vendor_id: string;
        };
        Returns: Json;
      };
      unlink_property_vendor: {
        Args: {
          p_expected_link_revision: string;
          p_property_id: string;
          p_vendor_id: string;
        };
        Returns: Json;
      };
      company_employee_daily_activity: {
        Args: { p_from: string; p_to: string };
        Returns: {
          business_day: string;
          distinct_properties_viewed: number;
          employee_email: string;
          employee_id: string;
          employee_name: string;
          owner_contact_properties: number;
          page_view_events: number;
        }[];
      };
      company_province_owner_contact_activity: {
        Args: { p_from: string; p_to: string };
        Returns: {
          official_code: string | null;
          owner_contact_properties: number;
          province_name: string | null;
          province_unit_id: string | null;
        }[];
      };
      my_daily_activity: {
        Args: { p_from: string; p_to: string };
        Returns: {
          business_day: string;
          distinct_properties_viewed: number;
          owner_contact_properties: number;
          page_view_events: number;
        }[];
      };
      my_today_activity: {
        Args: never;
        Returns: {
          business_day: string;
          distinct_properties_viewed: number;
          owner_contact_properties: number;
          page_view_events: number;
        }[];
      };
      edit_property_comment: {
        Args: {
          p_body: string;
          p_comment_id: string;
          p_key: string;
          p_property_id: string;
          p_revision: string;
        };
        Returns: Json;
      };
      post_property_comment: {
        Args: { p_body: string; p_key: string; p_property_id: string };
        Returns: Json;
      };
      remove_property_comment: {
        Args: {
          p_comment_id: string;
          p_kind: string;
          p_property_id: string;
          p_reason?: string;
          p_revision: string;
        };
        Returns: Json;
      };
      record_property_activity: {
        Args: {
          p_key: string;
          p_kind: string;
          p_notes?: string;
          p_property_id: string;
        };
        Returns: string;
      };
      record_rental_payment: {
        Args: {
          p_amount: number;
          p_evidence?: string;
          p_key: string;
          p_kind: string;
          p_method: string;
          p_month_id: string;
          p_paid_on: string;
          p_reference?: string;
        };
        Returns: string;
      };
      register_property_file: {
        Args: {
          p_category_id?: string;
          p_file_id: string;
          p_mime_type: string;
          p_original_filename: string;
          p_property_id: string;
          p_purpose?: string;
          p_sha256: string;
          p_size_bytes: number;
        };
        Returns: Json;
      };
      release_property_lock: {
        Args: { p_lock_id: string; p_reason: string };
        Returns: undefined;
      };
      request_property_lock: {
        Args: {
          p_evidence_file_id?: string;
          p_property_id: string;
          p_reason: string;
          p_reference?: string;
        };
        Returns: string;
      };
      reveal_owner_contact: {
        Args: { p_key: string; p_property_id: string };
        Returns: Json;
      };
      page_inventory: {
        Args: {
          p_order?: string | null;
          p_page?: number;
          p_page_size?: number;
          p_query?: string;
          p_status?: string;
          p_mode?: string;
          p_type?: string;
          p_price_min?: string;
          p_price_max?: string;
          p_area_min?: number;
          p_area_max?: number;
          p_area_id?: string;
          p_contact_id?: string;
        };
        Returns: {
          total_count: number;
          page_number: number;
          id: string;
          property_code: string;
          listing_mode: string;
          status: string;
          cover_file_id: string | null;
          frontage_m: string | null;
          depth_m: string | null;
          land_area_m2: string | null;
          floor_area_m2: string | null;
          floors: number | null;
          direction: string | null;
          access_type: string | null;
          entry_on: string | null;
          entry_source: string;
          age_days: number | null;
        }[];
      };
      stream_inventory: {
        Args: {
          p_order?: string | null;
          p_query?: string;
          p_offset?: number;
          p_limit?: number;
          p_status?: string;
          p_mode?: string;
          p_type?: string;
          p_price_min?: string;
          p_price_max?: string;
          p_area_min?: number;
          p_area_max?: number;
          p_province_id?: string;
          p_district_id?: string;
          p_commune_id?: string;
          p_contact_id?: string;
          p_address_format?: string;
          p_created_by?: string;
        };
        // One window of the stream beside the matching total. A window past the end, or a filter
        // that matches nothing, answers one row whose window columns are null, so the total is
        // stated by every read.
        Returns: {
          total_count: number;
          id: string | null;
          property_code: string | null;
          listing_mode: string | null;
          status: string | null;
          property_type: string | null;
          cover_file_id: string | null;
          frontage_m: string | null;
          depth_m: string | null;
          land_area_m2: string | null;
          floor_area_m2: string | null;
          floors: number | null;
          direction: string | null;
          access_type: string | null;
          entry_on: string | null;
          entry_source: string | null;
          age_days: number | null;
          created_at: string | null;
          updated_at: string | null;
          sale_price_vnd: string | null;
          monthly_rent_vnd: string | null;
        }[];
      };
      set_file_category: {
        Args: {
          p_category_id: string;
          p_file_id: string;
          p_property_id: string;
        };
        Returns: undefined;
      };
      set_my_locale: { Args: { p_locale: string }; Returns: undefined };
      set_property_status: {
        Args: {
          p_note?: string | null;
          p_property_id: string;
          p_status: string;
        };
        Returns: Json;
      };
      update_employee_profile: {
        Args: {
          p_employee_id: string;
          p_display_name: string;
          p_phone: string;
          p_role: string;
          p_bio: string;
        };
        Returns: Json;
      };
      update_my_profile: {
        Args: { p_display_name: string; p_bio: string };
        Returns: Json;
      };
      set_property_cover: {
        Args: { p_file_id?: string; p_property_id: string };
        Returns: undefined;
      };
      complete_property_sale: {
        Args: {
          p_completed_on: string;
          p_credited_employee_id: string;
          p_key: string;
          p_property_id: string;
          p_reference: string;
        };
        Returns: string;
      };
      completed_sale_ranking: {
        Args: { p_from: string; p_to: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
