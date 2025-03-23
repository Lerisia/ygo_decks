from django.urls import path
from .views import (
    create_record_group, get_user_record_groups, add_match_to_record_group,
    delete_record_group, delete_match_record, get_record_group_statistics,
    get_record_group_matches, get_record_group_statistics_full, update_record_group_name
)

urlpatterns = [
    path("record-groups/create/", create_record_group, name="create-record-group"),
    path("record-groups/", get_user_record_groups, name="get-user-record-groups"),
    path("record-groups/<int:record_group_id>/add-match/", add_match_to_record_group, name="add-match-to-record-group"),
    path("record-groups/<int:record_group_id>/delete/", delete_record_group, name="delete-record-group"),
    path("record-groups/<int:record_group_id>/statistics/", get_record_group_statistics, name="record-group-statistics"),
    path("record-groups/<int:record_group_id>/statistics/full/", get_record_group_statistics_full, name="record_group_statistics_full"),
    path("match-records/<int:match_id>/delete/", delete_match_record, name="delete-match-record"),
    path("record-groups/<int:record_group_id>/matches/", get_record_group_matches, name="record-group-matches"),
    path("record-groups/<int:record_group_id>/update-name/", update_record_group_name, name="update_record_group_name"),
]